package groot.mobile.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import groot.mobile.AppContainer
import groot.mobile.data.BotsState
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.CodeThreadSummary
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class HomeViewModel(private val container: AppContainer) : ViewModel() {
    val bots: StateFlow<BotsState> = container.bots.state

    val selected: StateFlow<String?> = container.session.selectedBot

    fun select(botId: String) = container.session.selectBot(botId)

    fun togglePin(botId: String) = container.bots.togglePin(botId)

    private val _threads = MutableStateFlow<List<CodeThreadSummary>?>(null)
    val threads: StateFlow<List<CodeThreadSummary>?> = _threads.asStateFlow()

    fun loadThreads() {
        viewModelScope.launch {
            _threads.value = try {
                if (container.code.harnesses().isEmpty()) null else container.code.threads()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                null
            }
        }
    }

    fun retry() {
        viewModelScope.launch { container.bots.refresh() }
    }

    companion object {
        fun current(bots: BotsState, selected: String?): BotListEntry? = bots.bot(selected) ?: bots.sorted.firstOrNull()
    }
}
