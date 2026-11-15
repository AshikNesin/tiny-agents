package groot.mobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.ThemeMode
import groot.mobile.AppContainer
import groot.mobile.data.Session
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val container: AppContainer) : ViewModel() {
    val themeMode: StateFlow<ThemeMode> = container.themeModeStore.themeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ThemeMode.System)

    val session: StateFlow<Session> = container.session.state

    val guest: Boolean get() = container.bots.state.value.guest

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { container.themeModeStore.setThemeMode(mode) }
    }

    /** Sign out here and tell the server; the token is forgotten either way. */
    fun signOut() {
        container.scope.launch {
            runCatching { container.api.logout() }
            container.session.signOut()
        }
    }

    /** "Reset all data": signed out, the server forgotten, preferences cleared, theme back to System. */
    fun resetAll() {
        container.scope.launch {
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
