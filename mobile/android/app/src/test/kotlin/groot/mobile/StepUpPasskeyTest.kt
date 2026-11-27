package groot.mobile

import groot.mobile.data.StepUp
import groot.mobile.data.api.ApiClient
import groot.mobile.data.api.ApiSession
import groot.mobile.data.api.TinyAgentsApi
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class StepUpPasskeyTest {
    private val requests = mutableListOf<Pair<String, String>>()

    private val api = TinyAgentsApi(
        ApiClient(
            object : ApiSession {
                override val serverUrl = "https://agents.example.com"
                override val token = "session"
                override fun onSessionInvalid() = Unit
            },
            OkHttpClient.Builder().addInterceptor { chain ->
                val request = chain.request()
                val body = Buffer().also { request.body?.writeTo(it) }.readUtf8()
                requests += request.url.encodedPath to body
                val data = when (request.url.encodedPath) {
                    "/api/v1/vault/step-up/options" -> """{"challenge":"c-1","rpId":"agents.example.com","allowCredentials":[]}"""
                    else -> """{"token":"held","expiresAt":${FIXED_NOW + 300_000}}"""
                }
                Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("""{"success":true,"data":$data}""".toResponseBody("application/json".toMediaType()))
                    .build()
            }.build(),
        ),
    )

    @Test
    fun `a passkey assertion for the server's challenge confirms it's you`() = runBlocking {
        val stepUp = StepUp(api) { FIXED_NOW }
        var asked: String? = null

        val token = stepUp.confirmWithPasskey { options ->
            asked = JSONObject(options).getString("challenge")
            """{"id":"cred-1","type":"public-key","response":{"signature":"sig"}}"""
        }

        assertEquals("held", token)
        assertEquals("held", stepUp.current())
        assertEquals("c-1", asked)
        val (path, body) = requests.last()
        assertEquals("/api/v1/vault/step-up", path)
        assertEquals("cred-1", JSONObject(body).getJSONObject("passkey").getString("id"))
    }
}
