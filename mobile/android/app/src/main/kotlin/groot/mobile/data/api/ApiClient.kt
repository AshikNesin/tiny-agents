package groot.mobile.data.api

import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val details: JSONObject? = null,
) : IOException(message)

class NetworkException(message: String, cause: Throwable? = null) : IOException(message, cause)

interface ApiSession {
    val serverUrl: String?

    val token: String?

    fun onSessionInvalid()
}

sealed interface SseSignal {
    data object Open : SseSignal

    data class Event(val json: JSONObject) : SseSignal

    data object Drop : SseSignal
}

class ApiClient(
    private val session: ApiSession,
    baseClient: OkHttpClient = OkHttpClient(),
) {
    private val http: OkHttpClient = baseClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val streamHttp: OkHttpClient = http.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()

    private val socketHttp: OkHttpClient = http.newBuilder()
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    suspend fun get(path: String, query: Map<String, String?> = emptyMap()): Any? =
        json(request("GET", path, query, null, emptyMap()))

    suspend fun post(path: String, body: JSONObject? = null, headers: Map<String, String> = emptyMap()): Any? =
        json(request("POST", path, emptyMap(), body ?: JSONObject(), headers))

    suspend fun put(path: String, body: JSONObject, headers: Map<String, String> = emptyMap()): Any? =
        json(request("PUT", path, emptyMap(), body, headers))

    suspend fun patch(path: String, body: JSONObject, headers: Map<String, String> = emptyMap()): Any? =
        json(request("PATCH", path, emptyMap(), body, headers))

    suspend fun delete(path: String, query: Map<String, String?> = emptyMap(), headers: Map<String, String> = emptyMap()): Any? =
        json(request("DELETE", path, query, null, headers))

    suspend fun getObject(path: String, query: Map<String, String?> = emptyMap()): JSONObject =
        get(path, query) as? JSONObject ?: JSONObject()

    suspend fun postObject(path: String, body: JSONObject? = null, headers: Map<String, String> = emptyMap()): JSONObject =
        post(path, body, headers) as? JSONObject ?: JSONObject()

    suspend fun upload(path: String, fileName: String, mimeType: String, body: RequestBody): JSONObject {
        val form = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, body)
            .build()
        val request = builder(path, emptyMap()).post(form).build()
        return json(request) as? JSONObject ?: JSONObject()
    }

    suspend fun download(path: String): Response {
        val response = execute(http, builder(path, emptyMap()).get().build())
        if (!response.isSuccessful) {
            val error = errorOf(response, response.body.string())
            response.close()
            throw error
        }
        return response
    }

    fun events(path: String): Flow<SseSignal> = channelFlow {
        var delayMs = FIRST_RETRY_MS
        while (isActive) {
            var refused = false
            val call = runCatching {
                streamHttp.newCall(builder(path, emptyMap()).header("Accept", "text/event-stream").get().build())
            }.getOrNull()
            if (call != null) {
                val reader = launch(Dispatchers.IO) {
                    try {
                        call.execute().use { response ->
                            if (!response.isSuccessful) {
                                refused = response.code == 401 || response.code == 403
                                if (response.code == 401) session.onSessionInvalid()
                                return@use
                            }
                            send(SseSignal.Open)
                            delayMs = FIRST_RETRY_MS
                            val source = response.body.source()
                            while (true) {
                                val line = source.readUtf8Line() ?: break
                                if (!line.startsWith("data:")) continue
                                val payload = line.substring(5).trim()
                                if (payload.isEmpty()) continue
                                val event = runCatching { JSONObject(payload) }.getOrNull() ?: continue
                                send(SseSignal.Event(event))
                            }
                        }
                    } catch (_: IOException) {
                    }
                }
                try {
                    reader.join()
                } finally {
                    call.cancel()
                }
            }
            if (refused) break
            send(SseSignal.Drop)
            delay(delayMs)
            delayMs = (delayMs * 2).coerceAtMost(MAX_RETRY_MS)
        }
    }

    fun webSocket(path: String, listener: WebSocketListener): WebSocket {
        val base = baseUrl()
        val url = base.resolve(path) ?: throw NetworkException("Invalid socket path")
        val request = Request.Builder().url(url).build()
        return socketHttp.newWebSocket(request, listener)
    }

    private fun baseUrl(): HttpUrl =
        session.serverUrl?.toHttpUrlOrNull() ?: throw NetworkException("No server is set")

    private fun builder(path: String, query: Map<String, String?>): Request.Builder {
        val base = baseUrl()
        val url = (base.resolve("$API_PREFIX$path") ?: throw NetworkException("Invalid path $path")).newBuilder()
        for ((name, value) in query) if (value != null) url.addQueryParameter(name, value)
        val builder = Request.Builder().url(url.build()).header("Accept", "application/json")
        session.token?.let { builder.header("Authorization", "Bearer $it") }
        return builder
    }

    private fun request(
        method: String,
        path: String,
        query: Map<String, String?>,
        body: JSONObject?,
        headers: Map<String, String>,
    ): Request {
        val builder = builder(path, query)
        for ((name, value) in headers) builder.header(name, value)
        return builder.method(method, body?.toString()?.toRequestBody(JSON)).build()
    }

    private suspend fun json(request: Request): Any? {
        val response = execute(http, request)
        val text = withContext(Dispatchers.IO) { response.use { it.body.string() } }
        if (!response.isSuccessful) throw errorOf(response, text)
        if (text.isBlank()) return null
        val envelope = runCatching { JSONTokener(text).nextValue() as? JSONObject }.getOrNull()
            ?: throw ApiException(response.code, "BAD_RESPONSE", "The server sent something that is not JSON.")
        if (!envelope.bool("success", true)) throw errorOf(response, text)
        return if (envelope.isNull("data")) null else envelope.opt("data")
    }

    private fun errorOf(response: Response, text: String): ApiException {
        val error = runCatching { JSONObject(text).objOrNull("error") }.getOrNull()
        val code = error?.stringOrNull("code") ?: "HTTP_${response.code}"
        val message = error?.stringOrNull("message") ?: fallbackMessage(response.code)
        if (response.code == 401 && code == SESSION_INVALID) session.onSessionInvalid()
        return ApiException(response.code, code, message, error?.objOrNull("details"))
    }

    private fun fallbackMessage(status: Int): String = when (status) {
        401 -> "You are signed out."
        403 -> "You are not allowed to do that."
        404 -> "Not found."
        413 -> "That is too large."
        429 -> "Too many requests. Wait a moment."
        in 500..599 -> "The server had a problem ($status)."
        else -> "Request failed ($status)."
    }

    private suspend fun execute(client: OkHttpClient, request: Request): Response =
        suspendCancellableCoroutine { continuation: CancellableContinuation<Response> ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            NetworkException("Could not reach ${request.url.host}. Check the connection.", e),
                        )
                    }
                }

                override fun onResponse(call: Call, response: Response) {
                    if (continuation.isActive) continuation.resume(response) else response.close()
                }
            })
        }

    companion object {
        const val API_PREFIX = "/api/v1"
        const val SESSION_INVALID = "SESSION_INVALID"
        private const val FIRST_RETRY_MS = 1_500L
        private const val MAX_RETRY_MS = 10_000L
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
