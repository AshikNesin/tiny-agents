package tinyagents.vnc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeysymsTest {
    @Test
    fun `printable Latin-1 maps to itself`() {
        assertEquals(0x20, Keysyms.fromChar(' '.code))
        assertEquals(0x41, Keysyms.fromChar('A'.code))
        assertEquals(0x61, Keysyms.fromChar('a'.code))
        assertEquals(0x7e, Keysyms.fromChar('~'.code))
        assertEquals(0xa0, Keysyms.fromChar(0xa0))
        assertEquals(0xe9, Keysyms.fromChar('é'.code))
        assertEquals(0xff, Keysyms.fromChar(0xff))
        for (c in 0x20..0x7e) assertEquals(c, Keysyms.fromChar(c))
    }

    @Test
    fun `other Unicode maps to 0x01000000 plus the code point`() {
        assertEquals(0x01000100, Keysyms.fromChar(0x100))
        assertEquals(0x010020ac, Keysyms.fromChar('€'.code))
        assertEquals(0x0101f600, Keysyms.fromChar(0x1f600))
        assertEquals(0x0110ffff, Keysyms.fromChar(0x10ffff))
    }

    @Test
    fun `control characters map to their keys or to none`() {
        assertEquals(0xff0d, Keysyms.fromChar('\n'.code))
        assertEquals(0xff0d, Keysyms.fromChar('\r'.code))
        assertEquals(0xff09, Keysyms.fromChar('\t'.code))
        assertEquals(0xff08, Keysyms.fromChar('\b'.code))
        assertEquals(0xff1b, Keysyms.fromChar(0x1b))
        assertEquals(0xffff, Keysyms.fromChar(0x7f))
        assertEquals(Keysyms.None, Keysyms.fromChar(0))
        assertEquals(Keysyms.None, Keysyms.fromChar(0x07))
        assertEquals(Keysyms.None, Keysyms.fromChar(0x85))
        assertEquals(Keysyms.None, Keysyms.fromChar(0xd800))
        assertEquals(Keysyms.None, Keysyms.fromChar(0x110000))
        assertEquals(Keysyms.None, Keysyms.fromChar(-1))
    }

    @Test
    fun `named keys have their X11 values`() {
        assertEquals(0xff08, Keysyms.BackSpace)
        assertEquals(0xff09, Keysyms.Tab)
        assertEquals(0xff0d, Keysyms.Return)
        assertEquals(0xff1b, Keysyms.Escape)
        assertEquals(0xffff, Keysyms.Delete)
        assertEquals(0xff50, Keysyms.Home)
        assertEquals(0xff57, Keysyms.End)
        assertEquals(0xff55, Keysyms.PageUp)
        assertEquals(0xff56, Keysyms.PageDown)
        assertEquals(listOf(0xff51, 0xff52, 0xff53, 0xff54), listOf(Keysyms.Left, Keysyms.Up, Keysyms.Right, Keysyms.Down))
        assertEquals(0xffbe, Keysyms.F1)
        assertEquals(0xffc9, Keysyms.F12)
        assertEquals(0xffe1, Keysyms.Shift_L)
        assertEquals(0xffe3, Keysyms.Control_L)
        assertEquals(0xffe9, Keysyms.Alt_L)
        assertEquals(0xffeb, Keysyms.Super_L)
    }

    @Test
    fun `android key codes map to keysyms`() {
        // The literals are android.view.KeyEvent.KEYCODE_* values; VncViewStateTest checks them
        // against the real constants.
        assertEquals(Keysyms.BackSpace, Keysyms.fromAndroidKeyCode(67))
        assertEquals(Keysyms.Delete, Keysyms.fromAndroidKeyCode(112))
        assertEquals(Keysyms.Return, Keysyms.fromAndroidKeyCode(66))
        assertEquals(Keysyms.Tab, Keysyms.fromAndroidKeyCode(61))
        assertEquals(Keysyms.Escape, Keysyms.fromAndroidKeyCode(111))
        assertEquals(Keysyms.Up, Keysyms.fromAndroidKeyCode(19))
        assertEquals(Keysyms.F1, Keysyms.fromAndroidKeyCode(131))
        assertEquals(Keysyms.F12, Keysyms.fromAndroidKeyCode(142))
        assertEquals(Keysyms.Control_L, Keysyms.fromAndroidKeyCode(113))
        assertNull("letters type characters", Keysyms.fromAndroidKeyCode(29))
        assertNull("Back stays with the app", Keysyms.fromAndroidKeyCode(4))
        assertNull(Keysyms.fromAndroidKeyCode(143))
    }
}
