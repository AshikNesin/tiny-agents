package groot.mobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.ThemeMode
import groot.mobile.AppContainer
import groot.mobile.data.Session
import groot.mobile.push.PushService
import groot.mobile.push.PushStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val container: AppContainer) : ViewModel() {
    val themeMode: StateFlow<ThemeMode> = container.themeModeStore.themeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ThemeMode.System)

    val session: StateFlow<Session> = container.session.state

    val guest: Boolean get() = container.bots.state.value.guest

    /** Where this phone stands with the server's notifications. */
    val push: StateFlow<PushStatus> = container.push.status

    private val _testNote = MutableStateFlow<String?>(null)

    /** What the last "Send test notification" came to. */
    val testNote: StateFlow<String?> = _testNote.asStateFlow()

    fun sendTestNotification() {
        _testNote.value = "Sending…"
        viewModelScope.launch {
            val failure = runCatching { container.push.sendTest() }.getOrElse { it.message ?: "Couldn't send" }
            _testNote.value = failure ?: "Sent. It should arrive in a few seconds."
        }
    }

    /** Register this phone again: after a server update, or when it failed. */
    fun retryPush() {
        container.push.retry()
    }

    /** The push services on this phone, for Settings' Push service row. */
    fun pushServices(): List<PushService> = container.push.services()

    fun choosePushService(id: String) {
        viewModelScope.launch { container.push.choose(id) }
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { container.themeModeStore.setThemeMode(mode) }
    }

    /** Sign out here and tell the server; the token is forgotten either way. */
    fun signOut() {
        container.scope.launch {
            // While the token still works: the server stops pushing to this phone.
            runCatching { container.push.signOut() }
            runCatching { container.api.logout() }
            container.session.signOut()
        }
    }

    /** "Reset all data": signed out, the server forgotten, preferences cleared, theme back to System. */
    fun resetAll() {
        container.scope.launch {
            runCatching { container.push.signOut() }
            runCatching { container.api.logout() }
            container.session.forgetServer()
            container.appPreferences.clear()
            container.themeModeStore.setThemeMode(ThemeMode.System)
        }
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory =
            viewModelFactory { initializer { SettingsViewModel(container) } }
    }
}
