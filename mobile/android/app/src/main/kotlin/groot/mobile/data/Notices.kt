package groot.mobile.data

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Short messages for the snackbar: a failed send, a refused action. Anything may post one. */
class Notices {
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    fun show(message: String) {
        _messages.tryEmit(message)
    }

    /** Post what [error] says, or [fallback] when it says nothing useful. */
    fun showError(error: Throwable, fallback: String) {
        show(error.message?.takeIf { it.isNotBlank() } ?: fallback)
    }
}
