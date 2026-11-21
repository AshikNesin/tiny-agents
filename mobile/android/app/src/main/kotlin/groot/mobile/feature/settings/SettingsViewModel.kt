package groot.mobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.ThemeMode
import groot.mobile.AppContainer
import groot.mobile.data.BotsState
import groot.mobile.data.Session
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

    val bots: StateFlow<BotsState> = container.bots.state

    val push: StateFlow<PushStatus> = container.push.status

    private val _testNote = MutableStateFlow<String?>(null)

    val testNote: StateFlow<String?> = _testNote.asStateFlow()

    fun sendTestNotification() {
        _testNote.value = "Sending…"
        viewModelScope.launch {
            val failure = runCatching { container.push.sendTest() }.getOrElse { it.message ?: "Couldn't send" }
            _testNote.value = failure ?: "Sent. It should arrive in a few seconds."
        }
    }

    fun retryPush() {
        container.push.retry()
    }

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { container.themeModeStore.setThemeMode(mode) }
    }

    fun signOut() {
        container.scope.launch {
            runCatching { container.push.signOut() }
            runCatching { container.api.logout() }
            container.session.signOut()
        }
    }

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
