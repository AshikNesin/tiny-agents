package groot.mobile.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import groot.mobile.data.api.TinyAgentsApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Loads uploaded images through the API (they need the session token, so a plain image URL
 * will not do) and keeps the decoded bitmaps in a small memory cache.
 */
class ImageStore(private val api: TinyAgentsApi) {
    private val cache = object : LruCache<String, Bitmap>(CACHE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    fun cached(uploadId: String): Bitmap? = cache.get(uploadId)

    fun clear() = cache.evictAll()

    /** The image, sampled down so neither side is much above [maxSidePx]; null when it cannot be loaded. */
    suspend fun load(uploadId: String, maxSidePx: Int = MAX_SIDE_PX): Bitmap? {
        cache.get(uploadId)?.let { return it }
        return try {
            val bytes = api.uploadContent(uploadId).use { response -> withContext(Dispatchers.IO) { response.body.bytes() } }
            withContext(Dispatchers.Default) { decode(bytes, maxSidePx) }?.also { cache.put(uploadId, it) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
    }

    private fun decode(bytes: ByteArray, maxSidePx: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSidePx) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private companion object {
        const val CACHE_BYTES = 48 * 1024 * 1024
        const val MAX_SIDE_PX = 1600
    }
}
