#!/bin/bash
# crafter-terminal Feature Showcase Script (Improved)
# Run with: bash showcase-improved.sh [fast|slow]
# Default: medium speed (good for screen recording)

SPEED="${1:-medium}"

# Timing based on speed
if [ "$SPEED" = "fast" ]; then
    SHORT_PAUSE=0.5
    LONG_PAUSE=1
elif [ "$SPEED" = "slow" ]; then
    SHORT_PAUSE=3
    LONG_PAUSE=5
else
    SHORT_PAUSE=1.5
    LONG_PAUSE=2.5
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
ITALIC='\033[3m'
UNDERLINE='\033[4m'
RESET='\033[0m'

pause() {
    sleep "${1:-$SHORT_PAUSE}"
}

# =============================================================================
# Header
# =============================================================================
clear  # Start with a real clear for clean presentation
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║                  crafter-terminal Feature Showcase                     ║${RESET}"
echo -e "${BOLD}${CYAN}║              Full VT100 Terminal Emulation in Browser             ║${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════════╝${RESET}"
echo
pause "$LONG_PAUSE"

# =============================================================================
# 1. ANSI Colors (16 colors)
# =============================================================================
echo -e "${BOLD}${YELLOW}█ ANSI Colors (16 colors)${RESET}"
echo
echo "Standard colors:"
for i in {30..37}; do
    echo -en "\033[${i}m███\033[0m "
done
echo
echo
echo "Bright colors:"
for i in {90..97}; do
    echo -en "\033[${i}m███\033[0m "
done
echo
echo
pause "$LONG_PAUSE"

# =============================================================================
# 2. 256 Color Palette (Condensed)
# =============================================================================
echo -e "${BOLD}${YELLOW}█ 256 Color Palette${RESET}"
echo
echo "System colors (0-15):"
for i in {0..15}; do
    printf "\033[48;5;%dm  \033[0m" $i
done
echo
echo
echo "Color cube sample:"
for i in {16..51}; do
    printf "\033[48;5;%dm \033[0m" $i
done
echo
for i in {52..87}; do
    printf "\033[48;5;%dm \033[0m" $i
done
echo
echo
echo "Grayscale ramp:"
for i in {232..255}; do
    printf "\033[48;5;%dm \033[0m" $i
done
echo
echo
pause "$LONG_PAUSE"

# =============================================================================
# 3. RGB True Color
# =============================================================================
echo -e "${BOLD}${YELLOW}█ RGB True Color (24-bit)${RESET}"
echo
echo "Color gradients:"
# Rainbow gradient
for i in {0..60}; do
    r=$((255 - i * 4))
    g=$((i * 4))
    b=$((128 + i * 2))
    printf "\033[38;2;%d;%d;%dm▓\033[0m" $r $g $b
done
echo
# Blue to purple gradient
for i in {0..60}; do
    r=$((i * 4))
    g=$((100))
    b=$((255 - i * 2))
    printf "\033[38;2;%d;%d;%dm▓\033[0m" $r $g $b
done
echo
echo
pause "$LONG_PAUSE"

# =============================================================================
# 4. Text Styles
# =============================================================================
echo -e "${BOLD}${YELLOW}█ Text Styles & Attributes${RESET}"
echo
echo -e "  ${BOLD}Bold${RESET}          ${DIM}Dim${RESET}           ${ITALIC}Italic${RESET}"
echo -e "  ${UNDERLINE}Underline${RESET}     \033[9mStrikethrough${RESET}  \033[7mReverse${RESET}"
echo -e "  ${BOLD}${RED}Bold Red${RESET}      ${ITALIC}${CYAN}Italic Cyan${RESET}   ${UNDERLINE}${GREEN}Under Green${RESET}"
echo
pause "$LONG_PAUSE"

# =============================================================================
# 5. Dynamic Updates - Matrix Rain
# =============================================================================
echo -e "${BOLD}${YELLOW}█ Dynamic Updates${RESET}"
echo
echo "Matrix-style falling text:"
echo

# Create space for matrix effect
echo
echo
echo
echo
echo
echo
echo
echo

# Save cursor position (we're at bottom of reserved space)
tput sc

# Do matrix rain - write characters going down columns
for frame in {1..15}; do
    for col in {5..65..6}; do
        chars=("0" "1" "ア" "イ" "ウ" "エ" "オ" "カ" "キ" "ク" "ケ" "コ")
        char=${chars[$RANDOM % ${#chars[@]}]}
        row=$((frame % 8 + 1))
        # Position relative to current cursor, write char, then restore
        tput rc
        tput cuu 8  # Move up 8 lines from saved position
        tput cuf $col  # Move right to column
        tput cud $row  # Move down to row
        echo -ne "\033[32m${char}\033[0m"
    done
    sleep 0.1
done

# Restore cursor to bottom of matrix area
tput rc
echo

pause "$LONG_PAUSE"

# =============================================================================
# 6. Progress Bars & Spinners
# =============================================================================
echo -e "${BOLD}${YELLOW}█ Progress Indicators${RESET}"
echo
echo "Loading simulation:"
echo

# Progress bar with fixed formatting
for i in {0..100..10}; do
    bar_length=$((i / 5))
    bar=$(printf '█%.0s' $(seq 1 $bar_length))
    spaces=$(printf ' %.0s' $(seq 1 $((20 - bar_length))))
    printf "\r  [%s%s] %3d%%" "$bar" "$spaces" $i
    sleep 0.15
done
echo
echo

# Spinner
echo -n "  Processing: "
spinners=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
for i in {1..20}; do
    printf "\b${spinners[$((i % 10))]}"
    sleep 0.1
done
printf "\b✓"
echo
echo
pause "$LONG_PAUSE"

# =============================================================================
# 7. Unicode & Emojis
# =============================================================================
echo -e "${BOLD}${YELLOW}█ Unicode Support${RESET}"
echo
echo "Emojis:      🚀 ⭐ 🎨 🔥 💻 🌈 ✨ 🎉 👍 ❤️  💡 🔒 📦 ⚡"
echo "Arrows:      ← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇑ ⇓ ⟵ ⟶ ⟷"
echo "Math:        ∞ ∑ ∏ ∫ ∂ √ ≈ ≠ ≤ ≥ ± × ÷"
echo "Box Drawing: ╔═══╗ ╚═══╝ ├─┼─┤ │ └─┴─┘"
echo "Symbols:     ★ ☆ ♠ ♣ ♥ ♦ ✓ ✗ ⚠ ⚡ ♪ ♫"
echo "CJK:         日本語 中文 한글 🇯🇵 🇨🇳 🇰🇷"
echo
pause "$LONG_PAUSE"

# =============================================================================
# 8. Scrollback Demo
# =============================================================================
echo -e "${BOLD}${YELLOW}█ Scrollback Buffer${RESET}"
echo
echo "Generating scrollable content..."
echo
for i in {1..50}; do
    color=$((31 + (i % 7)))
    echo -e "\033[${color}m► Line $i - Scroll test\033[0m"
done
echo
echo -e "${GREEN}✓ Scroll up with your mouse wheel to see all content!${RESET}"
echo
pause "$LONG_PAUSE"

# =============================================================================
# 9. Full-Screen Application Demo (htop)
# =============================================================================
echo -e "${BOLD}${YELLOW}█ Full-Screen Applications${RESET}"
echo
if command -v htop >/dev/null 2>&1; then
    echo "Launching htop (press 'q' to quit)..."
    sleep 2
    htop
    echo
    echo -e "${GREEN}✓ Alt-screen buffer preserved your scrollback!${RESET}"
    echo
elif command -v top >/dev/null 2>&1; then
    echo "Launching top (press 'q' to quit)..."
    sleep 2
    top
    echo
    echo -e "${GREEN}✓ Alt-screen buffer preserved your scrollback!${RESET}"
    echo
else
    echo "Install htop to see full-screen app demo"
    echo
fi

echo
echo -e "${BOLD}${CYAN}Showcase complete! Scroll up to see all features.${RESET}"
echo
