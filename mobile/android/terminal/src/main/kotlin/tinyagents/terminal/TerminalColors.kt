package tinyagents.terminal

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb

/**
 * The colours a terminal is drawn with. Only the 16 ANSI colours are given: the rest of the
 * xterm 256-colour palette (the 6x6x6 cube and the grey ramp) is computed.
 *
 * @param ansi exactly 16 colours: black, red, green, yellow, blue, magenta, cyan, white, then
 * their bright variants.
 */
@Immutable
public data class TerminalColors(
    val foreground: Color,
    val background: Color,
    val cursor: Color,
    val selection: Color,
    val ansi: List<Color>,
) {
    init {
        require(ansi.size == ANSI_COUNT) { "ansi needs $ANSI_COUNT colours, got ${ansi.size}" }
    }

    /** Palette colour [index] of the xterm 256-colour palette. */
    public fun indexed(index: Int): Color {
        val i = index.coerceIn(0, PALETTE_SIZE - 1)
        return if (i < ANSI_COUNT) ansi[i] else argbColor(xtermArgb(i))
    }

    /** The whole palette as ARGB ints, for the draw loop. */
    internal fun paletteArgb(): IntArray = IntArray(PALETTE_SIZE) { if (it < ANSI_COUNT) ansi[it].toArgb() else xtermArgb(it) }

    public companion object {
        private const val ANSI_COUNT = 16
        private const val PALETTE_SIZE = 256
        private const val CUBE_START = 16
        private const val GREY_START = 232
        private const val OPAQUE = 0xFF shl 24

        /** The foreground at about 30%, which reads as a selection on either theme. */
        private const val SELECTION_ALPHA = 0x4D

        // The web terminal's palettes (apps/web/src/client/lib/xterm.ts): xterm's stock colours
        // are built for a black background and are unreadable on a light one.
        private const val DARK_FOREGROUND = 0xFFEDEDED.toInt()
        private const val DARK_BACKGROUND = 0xFF141414.toInt()
        private val DARK_ANSI = intArrayOf(
            0xFF3B3B3B.toInt(), 0xFFF07178.toInt(), 0xFFA5D86E.toInt(), 0xFFE6C07B.toInt(),
            0xFF6CB6FF.toInt(), 0xFFD4A0F7.toInt(), 0xFF56D4DD.toInt(), 0xFFD6D6D6.toInt(),
            0xFF8A8A8A.toInt(), 0xFFFF8B92.toInt(), 0xFFBFEB8C.toInt(), 0xFFFFD98E.toInt(),
            0xFF8FCAFF.toInt(), 0xFFE5B8FF.toInt(), 0xFF7CE8EF.toInt(), 0xFFFFFFFF.toInt(),
        )

        private const val LIGHT_FOREGROUND = 0xFF1A1A1A.toInt()
        private const val LIGHT_BACKGROUND = 0xFFFAFAFA.toInt()
        private val LIGHT_ANSI = intArrayOf(
            0xFF24292F.toInt(), 0xFFCF222E.toInt(), 0xFF116329.toInt(), 0xFF8A6100.toInt(),
            0xFF0550AE.toInt(), 0xFF8250DF.toInt(), 0xFF1B7C83.toInt(), 0xFF6E7781.toInt(),
            0xFF6B6B6B.toInt(), 0xFFA40E26.toInt(), 0xFF1A7F37.toInt(), 0xFF7D4E00.toInt(),
            0xFF0969DA.toInt(), 0xFFA475F9.toInt(), 0xFF3192AA.toInt(), 0xFF8C959F.toInt(),
        )

        /** The dark palette of the web terminal. */
        public fun dark(): TerminalColors = fromArgb(DARK_FOREGROUND, DARK_BACKGROUND, DARK_ANSI)

        /** The light palette of the web terminal. */
        public fun light(): TerminalColors = fromArgb(LIGHT_FOREGROUND, LIGHT_BACKGROUND, LIGHT_ANSI)

        /**
         * Colours from ARGB ints, with the cursor in the foreground colour and the selection a
         * translucent foreground.
         */
        public fun fromArgb(foreground: Int, background: Int, ansi: IntArray): TerminalColors {
            require(ansi.size == ANSI_COUNT) { "ansi needs $ANSI_COUNT colours, got ${ansi.size}" }
            val selection = (foreground and OPAQUE.inv()) or (SELECTION_ALPHA shl 24)
            return TerminalColors(
                foreground = argbColor(foreground),
                background = argbColor(background),
                cursor = argbColor(foreground),
                selection = argbColor(selection),
                ansi = ansi.map(::argbColor),
            )
        }

        /** Entry `index` (16..255) of the xterm palette: a 6x6x6 colour cube, then 24 greys. */
        internal fun xtermArgb(index: Int): Int {
            if (index >= GREY_START) {
                val level = 8 + 10 * (index - GREY_START)
                return OPAQUE or (level shl 16) or (level shl 8) or level
            }
            val cube = index - CUBE_START
            return OPAQUE or (cubeLevel(cube / 36) shl 16) or (cubeLevel(cube / 6 % 6) shl 8) or cubeLevel(cube % 6)
        }

        private fun cubeLevel(step: Int): Int = if (step == 0) 0 else 55 + 40 * step

        private fun argbColor(argb: Int): Color = Color(argb)
    }
}
