package groot.mobile.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import groot.mobile.data.api.ApiSession
import groot.mobile.data.api.SessionUser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(name = "session")

/** Who is signed in, and to which server. */
data class Session(
    /** The server's origin ("https://agents.example.com"); null until one is chosen. */
    val serverUrl: String? = null,
    val token: String? = null,
    val user: SessionUser? = null,
) {
    val signedIn: Boolean get() = serverUrl != null && token != null
}

/** Seals the session token at rest. The default uses a key that never leaves the Android Keystore. */
interface TokenCipher {
    fun seal(plain: String): String

    /** Null when the sealed text cannot be opened (the key is gone): the owner signs in again. */
    fun open(sealed: String): String?
}

/** AES-GCM under a Keystore key. Falls back to storing as is where the Keystore is missing (unit tests). */
class KeystoreTokenCipher : TokenCipher {
    private fun key(): SecretKey? = runCatching {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }.getOrNull()

    override fun seal(plain: String): String {
        val key = key() ?: return PLAIN + plain
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key) }
            val sealed = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            SEALED + Base64.encodeToString(sealed, Base64.NO_WRAP)
        }.getOrElse { PLAIN + plain }
    }

    override fun open(sealed: String): String? {
        if (sealed.startsWith(PLAIN)) return sealed.removePrefix(PLAIN)
        if (!sealed.startsWith(SEALED)) return null
        val key = key() ?: return null
        return runCatching {
            val bytes = Base64.decode(sealed.removePrefix(SEALED), Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES)) }
            String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
        }.getOrNull()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "tiny_agents_session"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        const val SEALED = "v1:"
        const val PLAIN = "p:"
    }
}

/**
 * The session, kept across launches: the server, the token (sealed at rest) and the user.
 * It is the [ApiSession] every request reads, so signing out stops requests at once.
 */
class SessionStore(
    private val dataStore: DataStore<Preferences>,
    private val cipher: TokenCipher,
    private val scope: CoroutineScope,
) : ApiSession {
    private val _state = MutableStateFlow(Session())
    val state: StateFlow<Session> = _state.asStateFlow()

    override val serverUrl: String? get() = _state.value.serverUrl
    override val token: String? get() = _state.value.token

    private val _selectedBot = MutableStateFlow<String?>(null)

    /** The bot whose chat is open; remembered, so the app reopens on it. */
    val selectedBot: StateFlow<String?> = _selectedBot.asStateFlow()

    /** Read the stored session once, before the first screen is chosen. */
    suspend fun load() {
        val prefs = dataStore.data.first()
        val token = prefs[TOKEN]?.let(cipher::open)
        val userId = prefs[USER_ID]
        _selectedBot.value = prefs[LAST_BOT]
        _state.value = Session(
            serverUrl = prefs[SERVER],
            token = token,
            user = if (token != null && userId != null) SessionUser(userId, prefs[USER_EMAIL].orEmpty(), prefs[USER_NAME]) else null,
        )
    }

    suspend fun setServer(url: String) {
        _state.update { Session(serverUrl = url) }
        dataStore.edit {
            it.clear()
            it[SERVER] = url
        }
    }

    suspend fun signedIn(token: String, user: SessionUser) {
        _state.update { it.copy(token = token, user = user) }
        dataStore.edit {
            it[TOKEN] = cipher.seal(token)
            it[USER_ID] = user.id
            it[USER_EMAIL] = user.email
            if (user.name != null) it[USER_NAME] = user.name else it.remove(USER_NAME)
        }
    }

    /** Forget the token and user; the server stays, so signing back in is one step. */
    suspend fun signOut() {
        _state.update { Session(serverUrl = it.serverUrl) }
        _selectedBot.value = null
        dataStore.edit {
            it.remove(TOKEN)
            it.remove(USER_ID)
            it.remove(USER_EMAIL)
            it.remove(USER_NAME)
            it.remove(LAST_BOT)
        }
    }

    /** Forget everything, the server included. */
    suspend fun forgetServer() {
        _state.value = Session()
        _selectedBot.value = null
        dataStore.edit { it.clear() }
    }

    fun selectBot(id: String?) {
        _selectedBot.value = id
        scope.launch { dataStore.edit { if (id != null) it[LAST_BOT] = id else it.remove(LAST_BOT) } }
    }

    override fun onSessionInvalid() {
        if (_state.value.token == null) return
        scope.launch { signOut() }
    }

    companion object {
        private val SERVER = stringPreferencesKey("server_url")
        private val TOKEN = stringPreferencesKey("token")
        private val USER_ID = intPreferencesKey("user_id")
        private val USER_EMAIL = stringPreferencesKey("user_email")
        private val USER_NAME = stringPreferencesKey("user_name")
        private val LAST_BOT = stringPreferencesKey("last_bot")

        fun create(context: Context, scope: CoroutineScope): SessionStore =
            SessionStore(context.applicationContext.sessionDataStore, KeystoreTokenCipher(), scope)

        /**
         * A server address as the owner typed it, as an origin: a scheme is added (https, or
         * http for a bare IP or localhost), and any path is dropped. Null when it is not a URL.
         */
        fun normalizeServerUrl(input: String): String? {
            val text = input.trim().trimEnd('/')
            if (text.isEmpty() || text.any { it.isWhitespace() }) return null
            val withScheme = when {
                text.startsWith("http://", ignoreCase = true) || text.startsWith("https://", ignoreCase = true) -> text
                LOCAL_HOST.containsMatchIn(text) -> "http://$text"
                else -> "https://$text"
            }
            val uri = runCatching { java.net.URI(withScheme) }.getOrNull() ?: return null
            val host = uri.host ?: return null
            if (host.isEmpty()) return null
            val port = if (uri.port > 0) ":${uri.port}" else ""
            return "${uri.scheme.lowercase()}://${host.lowercase()}$port"
        }

        /** A bare IPv4 address, localhost or a `.local` name: plain http unless the owner says otherwise. */
        private val LOCAL_HOST = Regex("^(localhost|\\d{1,3}(\\.\\d{1,3}){3}|[\\w-]+\\.local)(:\\d+)?(/|$)", RegexOption.IGNORE_CASE)
    }
}
