package groot.mobile.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.mobile.data.Notices
import groot.mobile.ui.brand.AppIcons
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface Loadable<out T> {
    data object Loading : Loadable<Nothing>
    data class Failed(val message: String) : Loadable<Nothing>
    data class Ready<T>(val value: T) : Loadable<T>
}

class ResourceViewModel<T>(private val notices: Notices, private val load: suspend () -> T) : ViewModel() {
    private val _state = MutableStateFlow<Loadable<T>>(Loadable.Loading)
    val state: StateFlow<Loadable<T>> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                _state.value = Loadable.Ready(load())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (_state.value !is Loadable.Ready) _state.value = Loadable.Failed(e.message ?: "Could not load.")
            }
        }
    }

    fun act(failure: String, done: () -> Unit = {}, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
                done()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notices.showError(e, failure)
            }
            refresh()
        }
    }
}

@Composable
fun <T> rememberResource(key: String, load: suspend () -> T): ResourceViewModel<T> {
    val notices = LocalContainer.current.notices
    return viewModel(key = key, factory = viewModelFactory { initializer { ResourceViewModel(notices, load) } })
}

@Composable
fun <T> LoadableContent(resource: ResourceViewModel<T>, content: @Composable (T) -> Unit) {
    val state by resource.state.collectAsStateWithLifecycle()
    LoadableContent(state, onRetry = resource::refresh, content = content)
}

@Composable
fun <T> LoadableContent(state: Loadable<T>, onRetry: () -> Unit, content: @Composable (T) -> Unit) {
    when (state) {
        Loadable.Loading -> LoadingBox()
        is Loadable.Failed -> EmptyState(
            title = "Could not load",
            body = state.message,
            icon = AppIcons.Alert,
            actionLabel = "Try again",
            onAction = onRetry,
        )
        is Loadable.Ready -> content(state.value)
    }
}
