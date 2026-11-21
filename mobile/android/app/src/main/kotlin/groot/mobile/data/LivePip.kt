package groot.mobile.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class PipCorner(val top: Boolean, val start: Boolean) {
    TopStart(top = true, start = true),
    TopEnd(top = true, start = false),
    BottomStart(top = false, start = true),
    BottomEnd(top = false, start = false),
}

data class PipTarget(val surface: String, val botId: String)

class LivePip {
    private val _current = MutableStateFlow<PipTarget?>(null)
    val current: StateFlow<PipTarget?> = _current.asStateFlow()

    fun open(surface: String, botId: String) {
        _current.value = PipTarget(surface, botId)
    }

    fun close() {
        _current.value = null
    }
}
