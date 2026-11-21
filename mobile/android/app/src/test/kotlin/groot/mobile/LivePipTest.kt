package groot.mobile

import groot.mobile.data.LivePip
import groot.mobile.data.PipCorner
import groot.mobile.data.PipTarget
import groot.mobile.feature.live.nearestCorner
import groot.mobile.feature.live.pipAspect
import groot.mobile.feature.live.pipWidth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LivePipTest {
    @Test
    fun `the picture takes the remote display's shape within 1 to 2 and 16 to 9`() {
        assertEquals(1.6f, pipAspect(0, 0), 0.001f)
        assertEquals(1.6f, pipAspect(1280, 800), 0.001f)
        assertEquals(1.778f, pipAspect(1920, 1080), 0.001f)
        assertEquals(1.778f, pipAspect(2560, 720), 0.001f)
        assertEquals(0.5f, pipAspect(400, 900), 0.001f)
    }

    @Test
    fun `an upright display makes the window narrower, not taller`() {
        assertEquals(240f, pipWidth(maxWidth = 240f, maxStreamHeight = 160f, available = 300f, aspect = 1.6f), 0.001f)
        assertEquals(80f, pipWidth(maxWidth = 240f, maxStreamHeight = 160f, available = 300f, aspect = 0.5f), 0.001f)
        assertEquals(200f, pipWidth(maxWidth = 240f, maxStreamHeight = 160f, available = 200f, aspect = 1.6f), 0.001f)
    }

    @Test
    fun `a dropped window snaps to the corner nearest its centre`() {
        assertEquals(PipCorner.TopStart, nearestCorner(10f, 10f, 100f, 100f))
        assertEquals(PipCorner.TopEnd, nearestCorner(90f, 20f, 100f, 100f))
        assertEquals(PipCorner.BottomStart, nearestCorner(20f, 70f, 100f, 100f))
        assertEquals(PipCorner.BottomEnd, nearestCorner(90f, 80f, 100f, 100f))
    }

    @Test
    fun `one picture at a time, and closing it clears it`() {
        val pip = LivePip()
        pip.open("browser", "b1")
        pip.open("computer", "b2")
        assertEquals(PipTarget("computer", "b2"), pip.current.value)
        pip.close()
        assertNull(pip.current.value)
    }
}
