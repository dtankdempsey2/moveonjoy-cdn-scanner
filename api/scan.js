// File: /api/scan.js

// In-memory storage
const cache404 = new Map(); // { url: expiryTime }
const cacheSuccess = new Map(); // { cacheKey: { url: string, expiryTime: number } }
const pendingRequests = new Map(); // { cacheKey: Promise }

const CACHE_404_DURATION = 120000; // 2 minutes
const CACHE_SUCCESS_DURATION = 600000; // 10 minutes

export default async function handler(req, res) {
  const inputUrl = req.query.url;
  const min = Math.max(parseInt(req.query.min || "1", 10), 1);
  const max = Math.min(parseInt(req.query.max || "100", 10), 500);
  
  console.log(`[${new Date().toISOString()}] New request - URL: ${inputUrl}, Range: ${min}-${max}`);
  
  if (min > max) {
    console.log(`[ERROR] Invalid range: min(${min}) > max(${max})`);
    return res.status(400).send("Invalid range: min cannot be greater than max");
  }
  if (!inputUrl) {
    console.log(`[ERROR] Missing URL parameter`);
    return res.status(400).send("Missing ?url parameter");
  }
  
  // Get client IP for logging
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || 
                   req.headers['x-real-ip'] || 
                   req.socket.remoteAddress;
  
  console.log(`[INFO] Client IP: ${clientIp}`);
  
  try {
    const parsed = new URL(inputUrl);
    if (!parsed.hostname.endsWith("moveonjoy.com")) {
      console.log(`[ERROR] Invalid domain: ${parsed.hostname}`);
      return res.status(403).send("Only moveonjoy.com domains allowed");
    }
    
    // Create cache key
    const cacheKey = `${inputUrl}:${min}:${max}`;
    const now = Date.now();
    
    // Check success cache first
    const cachedSuccess = cacheSuccess.get(cacheKey);
    if (cachedSuccess && now < cachedSuccess.expiryTime) {
      const remainingMs = cachedSuccess.expiryTime - now;
      console.log(`[CACHE_HIT] Success cached for ${cacheKey}, expires in ${Math.round(remainingMs/1000)}s - returning ${cachedSuccess.url}`);
      return res.redirect(302, cachedSuccess.url);
    }
    
    // Check 404 cache
    const cached404Time = cache404.get(cacheKey);
    if (cached404Time && now < cached404Time) {
      const remainingMs = cached404Time - now;
      console.log(`[CACHE_HIT] 404 cached for ${cacheKey}, expires in ${Math.round(remainingMs/1000)}s`);
      return res.status(404).send("No valid CDN found (cached)");
    }
    
    // Check if there's already a pending request for this same channel
    if (pendingRequests.has(cacheKey)) {
      console.log(`[DEDUP] Request for ${cacheKey} already in progress, waiting...`);
      const result = await pendingRequests.get(cacheKey);
      console.log(`[DEDUP] Got result from pending request: ${result ? result : '404'}`);
      
      if (result) {
        return res.redirect(302, result);
      } else {
        return res.status(404).send("No valid CDN found (cached)");
      }
    }
    
    // No cache hit and no pending request - do the actual scan
    const path = parsed.pathname;
    const protocol = parsed.protocol;
    const timeout = 2500;
    
    console.log(`[SCAN_START] Checking ${max - min + 1} CDN nodes (fl${min}-fl${max})`);
    const scanStartTime = Date.now();
    
    const checkOne = async (i) => {
      const url = `${protocol}//fl${i}.moveonjoy.com${path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(url, { method: "GET", signal: controller.signal });
        if (response.ok) {
          console.log(`[CDN_FOUND] fl${i} responded with ${response.status}`);
          return url;
        }
        throw new Error("Not OK");
      } catch (err) {
        // Silent fail for individual CDN checks
        throw new Error("Failed");
      } finally {
        clearTimeout(timer);
      }
    };
    
    // Create the scanning promise and store it for deduplication
    const scanPromise = (async () => {
      const checks = [];
      for (let i = min; i <= max; i++) {
        checks.push(checkOne(i));
      }
      
      const goodUrl = await Promise.any(checks).catch(() => null);
      const scanDuration = Date.now() - scanStartTime;
      
      if (goodUrl) {
        console.log(`[SUCCESS] Found working CDN in ${scanDuration}ms: ${goodUrl}`);
        
        // Cache the successful result
        cacheSuccess.set(cacheKey, {
          url: goodUrl,
          expiryTime: now + CACHE_SUCCESS_DURATION
        });
        console.log(`[CACHE_SET] Added ${cacheKey} to success cache, total cached: ${cacheSuccess.size}`);
        
        // Remove from 404 cache if it was there
        if (cache404.has(cacheKey)) {
          cache404.delete(cacheKey);
          console.log(`[CACHE_CLEAR] Removed ${cacheKey} from 404 cache`);
        }
        
        // Clean up expired success cache entries
        let cleanedSuccess = 0;
        for (const [key, data] of cacheSuccess.entries()) {
          if (now > data.expiryTime) {
            cacheSuccess.delete(key);
            cleanedSuccess++;
          }
        }
        if (cleanedSuccess > 0) {
          console.log(`[CLEANUP] Removed ${cleanedSuccess} expired success cache entries`);
        }
        
        return goodUrl;
      } else {
        console.log(`[FAIL] No valid CDN found after ${scanDuration}ms, caching 404 for 2min`);
        
        // Cache the 404 result
        cache404.set(cacheKey, now + CACHE_404_DURATION);
        console.log(`[CACHE_SET] Added ${cacheKey} to 404 cache, total cached: ${cache404.size}`);
        
        // Clean up expired 404 cache entries
        let cleaned404 = 0;
        for (const [key, expiry] of cache404.entries()) {
          if (now > expiry) {
            cache404.delete(key);
            cleaned404++;
          }
        }
        if (cleaned404 > 0) {
          console.log(`[CLEANUP] Removed ${cleaned404} expired 404 cache entries`);
        }
        
        return null;
      }
    })();
    
    // Store the promise so other requests can wait for it
    pendingRequests.set(cacheKey, scanPromise);
    console.log(`[DEDUP] Started new scan for ${cacheKey}, total pending: ${pendingRequests.size}`);
    
    try {
      const result = await scanPromise;
      
      if (result) {
        return res.redirect(302, result);
      } else {
        return res.status(404).send("No valid CDN found in given range");
      }
    } finally {
      // Clean up the pending request
      pendingRequests.delete(cacheKey);
      console.log(`[DEDUP] Removed ${cacheKey} from pending requests`);
    }
    
  } catch (err) {
    console.log(`[ERROR] URL parsing failed: ${err.message}`);
    return res.status(400).send("Invalid URL format");
  }
}