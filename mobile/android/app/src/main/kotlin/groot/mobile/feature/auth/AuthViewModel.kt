package groot.mobile.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import groot.mobile.data.SessionStore
import groot.mobile.data.api.TinyAgentsApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AuthState(
    /** The server is chosen: the screen asks for the account. */
    val serverUrl: String? = null,
    /** The server has no account yet: the form creates the first one. */
    val needsSetup: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
)

/** Sign-in in two steps: which server, then who. A fresh server offers to create its first account. */
class AuthViewModel(private val session: SessionStore, private val api: TinyAgentsApi) : ViewModel() {
    private val _state = MutableStateFlow(AuthState(serverUrl = session.state.value.serverUrl))
    val state: StateFlow<AuthState> = _state.asStateFlow()

    init {
        // A stored server (signed out earlier): ask it whether it still needs its first account.
        if (session.state.value.serverUrl != null) probe()
    }

    /** Check the address answers like a tiny-agents server, then move on to the account. */
    fun connect(input: String) {
        val url = SessionStore.normalizeServerUrl(input)
        if (url == null) {
            _state.update { it.copy(error = "Enter your server's address, like agents.example.com.") }
            return
        }
        launchBusy {
            // Requests read the server from the session, so it is set first and dropped again if nothing answers.
            session.setServer(url)
            try {
                val needsSetup = api.needsSetup()
                _state.update { it.copy(serverUrl = url, needsSetup = needsSetup) }
            } catch (e: Exception) {
                session.forgetServer()
                throw e
            }
        }
    }

    private fun probe() = launchBusy {
        val needsSetup = api.needsSetup()
        _state.update { it.copy(needsSetup = needsSetup) }
    }

    fun changeServer() {
        viewModelScope.launch {
            session.forgetServer()
            _state.value = AuthState()
        }
    }

    fun submit(email: String, password: String, name: String) {
        if (email.isBlank() || password.isEmpty()) {
            _state.update { it.copy(error = "Enter your email and password.") }
            return
        }
        launchBusy {
            val signIn = if (_state.value.needsSetup) {
                api.setup(email.trim(), password, name.trim().ifEmpty { null })
            } else {
                api.login(email.trim(), password)
            }
            session.signedIn(signIn.token, signIn.user)
        }
    }

    private fun launchBusy(block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                block()
                _state.update { it.copy(busy = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = e.message ?: "Something went wrong.") }
            }
        }
    }
}
