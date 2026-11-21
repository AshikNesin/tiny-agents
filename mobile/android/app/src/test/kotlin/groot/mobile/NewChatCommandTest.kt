package groot.mobile

import groot.mobile.data.chat.ChatHealth
import groot.mobile.feature.chat.NewChatCommand
import groot.mobile.feature.chat.newChatCommand
import org.junit.Assert.assertEquals
import org.junit.Test

class NewChatCommandTest {
    private fun decide(text: String, attachments: Int = 0, guest: Boolean? = false, health: ChatHealth = ChatHealth.Live, empty: Boolean = false) =
        newChatCommand(text, attachments, guest, health, empty)

    @Test
    fun `typing just slash new on a loaded chat starts a new chat`() {
        assertEquals(NewChatCommand.Reset, decide("/new"))
        assertEquals(NewChatCommand.Reset, decide("  /new \n"))
    }

    @Test
    fun `anything more than slash new, or from a guest, is sent as a message`() {
        assertEquals(NewChatCommand.Send, decide("/new ideas for dinner"))
        assertEquals(NewChatCommand.Send, decide("/New"))
        assertEquals(NewChatCommand.Send, decide("/new", attachments = 1))
        assertEquals(NewChatCommand.Send, decide("/new", guest = true))
    }

    @Test
    fun `slash new waits for the chat and the account to load, and only clears an empty chat`() {
        assertEquals(NewChatCommand.Wait, decide("/new", health = ChatHealth.Loading))
        assertEquals(NewChatCommand.Wait, decide("/new", guest = null))
        assertEquals(NewChatCommand.Clear, decide("/new", empty = true))
    }
}
