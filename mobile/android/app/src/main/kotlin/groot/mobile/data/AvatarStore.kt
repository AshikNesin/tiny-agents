package groot.mobile.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cache
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Bot avatars: the same DiceBear "gaze" face the web app draws (`BotAvatar.tsx`), seeded by
 * the bot's name, so a bot looks the same on both clients. Fetched as PNG (Android draws no
 * SVG without a library), kept decoded in memory and raw on disk so they survive restarts
 * and show offline once seen.
 */
class AvatarStore(cacheDir: File?, client: OkHttpClient = OkHttpClient()) {
    private val http: OkHttpClient = client.newBuilder()
        .apply { if (cacheDir != null) cache(Cache(File(cacheDir, "avatars"), DISK_BYTES)) }
        .build()
    private val memory = object : LruCache<String, Bitmap>(MEMORY_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }
    private val inFlight = ConcurrentHashMap<String, CompletableDeferred<Bitmap?>>()

    fun cached(name: String): Bitmap? = memory.get(key(name))

    /** The bot's face, or null when it cannot be fetched (offline, blocked); callers fall back to the initial. */
    suspend fun load(name: String): Bitmap? {
        val key = key(name)
        memory.get(key)?.let { return it }
        val mine = CompletableDeferred<Bitmap?>()
        val running = inFlight.putIfAbsent(key, mine)
        if (running != null) return running.await()
        return try {
            fetch(key).also { bitmap ->
                if (bitmap != null) memory.put(key, bitmap)
                mine.complete(bitmap)
            }
        } catch (e: CancellationException) {
            mine.complete(null)
            throw e
        } finally {
            inFlight.remove(key)
        }
    }

    private suspend fun fetch(seed: String): Bitmap? = withContext(Dispatchers.IO) {
        try {
            http.newCall(Request.Builder().url(avatarUrl(seed)).build()).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val bytes = response.body.bytes()
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val MEMORY_BYTES = 4 * 1024 * 1024
        private const val DISK_BYTES = 4L * 1024 * 1024
        private const val SIZE_PX = 144

        /** The web app seeds with the raw name; so does this, or the faces would differ. */
        private fun key(name: String): String = name

        /** The web app's avatar URL, as PNG at one size that stays crisp up to the large avatar. */
        fun avatarUrl(name: String): String =
            "https://api.dicebear.com/10.x/gaze/png".toHttpUrl().newBuilder()
                .addQueryParameter("seed", key(name))
                .addQueryParameter("size", SIZE_PX.toString())
                .build()
                .toString()
    }
}
