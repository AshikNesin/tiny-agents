package groot.mobile

import groot.mobile.data.BotsState
import groot.mobile.feature.live.LiveState
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerRoleTest {
    @Test
    fun `the viewer is neither owner nor guest until people me answers`() {
        assertNull(BotsState().role)
    }

    @Test
    fun `the live view stays watch only until the viewer is known to be the owner`() {
        assertTrue(LiveState().guest)
    }
}
