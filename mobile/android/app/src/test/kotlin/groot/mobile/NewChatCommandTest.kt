package groot.mobile

import groot.mobile.feature.chat.isNewChatCommand
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NewChatCommandTest {
    @Test
    fun `typing just slash new starts a new chat`() {
        assertTrue(isNewChatCommand("/new", attachments = 0))
        assertTrue(isNewChatCommand("  /new \n", attachments = 0))
    }

    @Test
    fun `anything more than slash new is sent as a message`() {
        assertFalse(isNewChatCommand("/new ideas for dinner", attachments = 0))
        assertFalse(isNewChatCommand("/New", attachments = 0))
        assertFalse(isNewChatCommand("/new", attachments = 1))
    }
}
