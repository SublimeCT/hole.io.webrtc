import "./style.css";

import { Game, type GamePreferences, type GameUi } from "./game/Game";

const PREFERENCES_KEY = "hole-city-player-preferences";
const DEFAULT_PREFERENCES: GamePreferences = {
  playerName: "YOU",
  playerRingColor: "#6ef2d0",
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const ui: GameUi = {
  score: requireElement("#score"),
  radius: requireElement("#radius"),
  sizeLevel: requireElement("#size-level"),
  growthCopy: requireElement("#growth-copy"),
  growthFill: requireElement("#growth-fill"),
  time: requireElement("#time"),
  rankingRows: [
    {
      root: requireElement("#rank-first"),
      position: requireElement("#rank-first-position"),
      name: requireElement("#rank-first-name"),
      score: requireElement("#rank-first-score"),
    },
    {
      root: requireElement("#rank-second"),
      position: requireElement("#rank-second-position"),
      name: requireElement("#rank-second-name"),
      score: requireElement("#rank-second-score"),
    },
    {
      root: requireElement("#rank-third"),
      position: requireElement("#rank-third-position"),
      name: requireElement("#rank-third-name"),
      score: requireElement("#rank-third-score"),
    },
  ],
  finalRank: requireElement("#final-rank"),
  finalRankingRows: [
    {
      root: requireElement("#final-rank-first"),
      position: requireElement("#final-rank-first-position"),
      name: requireElement("#final-rank-first-name"),
      score: requireElement("#final-rank-first-score"),
    },
    {
      root: requireElement("#final-rank-second"),
      position: requireElement("#final-rank-second-position"),
      name: requireElement("#final-rank-second-name"),
      score: requireElement("#final-rank-second-score"),
    },
    {
      root: requireElement("#final-rank-third"),
      position: requireElement("#final-rank-third-position"),
      name: requireElement("#final-rank-third-name"),
      score: requireElement("#final-rank-third-score"),
    },
  ],
  dragPad: requireElement("#drag-pad"),
  dragKnob: requireElement("#drag-knob"),
  gameOver: requireElement("#game-over"),
  finalScore: requireElement("#final-score"),
  restart: requireElement<HTMLButtonElement>("#restart"),
  loading: requireElement("#loading"),
  loadingBar: requireElement("#loading-bar"),
  loadingStatus: requireElement("#loading-status"),
  launchScreen: requireElement("#launch-screen"),
  startMatch: requireElement<HTMLButtonElement>("#start-match"),
  scoreEffects: requireElement("#score-effects"),
  opponentIndicators: [
    {
      root: requireElement("#bot-one-indicator"),
      arrow: requireElement("#bot-one-arrow"),
      distance: requireElement("#bot-one-distance"),
    },
    {
      root: requireElement("#bot-two-indicator"),
      arrow: requireElement("#bot-two-arrow"),
      distance: requireElement("#bot-two-distance"),
    },
  ],
};

const settingsDialog = requireElement<HTMLElement>("#settings-dialog");
const onlineDialog = requireElement<HTMLElement>("#online-dialog");
const settingsForm = requireElement<HTMLFormElement>("#settings-form");
const playerNameInput = requireElement<HTMLInputElement>("#player-name");
const shareStatus = requireElement("#share-status");
const colorSwatches = [...document.querySelectorAll<HTMLButtonElement>(".color-swatch")];

function loadPreferences(): GamePreferences {
  try {
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (!saved) {
      return { ...DEFAULT_PREFERENCES };
    }
    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "playerName" in parsed &&
      "playerRingColor" in parsed &&
      typeof parsed.playerName === "string" &&
      typeof parsed.playerRingColor === "string"
    ) {
      return {
        playerName: parsed.playerName.slice(0, 9).trim() || DEFAULT_PREFERENCES.playerName,
        playerRingColor: parsed.playerRingColor,
      };
    }
  } catch {
    // Preferences are optional and must not prevent the game from starting.
  }
  return { ...DEFAULT_PREFERENCES };
}

function persistPreferences(preferences: GamePreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}

function updateColorSwatches(color: string): void {
  colorSwatches.forEach((swatch) => {
    const selected = swatch.dataset.color === color;
    swatch.classList.toggle("is-selected", selected);
    swatch.setAttribute("aria-pressed", selected.toString());
  });
}

let preferences = loadPreferences();
let selectedRingColor = preferences.playerRingColor;
playerNameInput.value = preferences.playerName;
updateColorSwatches(selectedRingColor);

let game: Game | null = null;

const startMatchButton = ui.startMatch;
const settingsButton = requireElement<HTMLButtonElement>("#open-settings");
const onlineButton = requireElement<HTMLButtonElement>("#online-play");
const shareButton = requireElement<HTMLButtonElement>("#share-game");
const cancelSettingsButton = requireElement<HTMLButtonElement>("#cancel-settings");
const closeOnlineButton = requireElement<HTMLButtonElement>("#close-online");
const menuButtons = [startMatchButton, settingsButton, onlineButton, shareButton] as const;

function syncMenuFocus(target: HTMLElement = document.activeElement as HTMLElement): void {
  menuButtons.forEach((button) => {
    button.classList.toggle("is-menu-focused", button === target);
  });
}

menuButtons.forEach((button) => {
  button.addEventListener("focus", () => syncMenuFocus(button));
});

async function bootstrap(): Promise<void> {
  try {
    game = await Game.create(requireElement<HTMLCanvasElement>("#game-canvas"), ui, preferences);
    game.start();
    startMatchButton.focus();
    syncMenuFocus(startMatchButton);
  } catch (error: unknown) {
    ui.loadingStatus.textContent = "LOAD ERROR";
    console.error(error);
  }
}

function openSettings(): void {
  playerNameInput.value = preferences.playerName;
  selectedRingColor = preferences.playerRingColor;
  updateColorSwatches(selectedRingColor);
  settingsDialog.hidden = false;
  playerNameInput.focus();
}

function closeSettings(): void {
  settingsDialog.hidden = true;
  settingsButton.focus();
}

settingsButton.addEventListener("click", openSettings);
cancelSettingsButton.addEventListener("click", closeSettings);

colorSwatches.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    const color = swatch.dataset.color;
    if (!color) {
      return;
    }
    selectedRingColor = color;
    updateColorSwatches(color);
  });
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const playerName = playerNameInput.value.trim();
  if (playerName.length < 1 || playerName.length > 9) {
    playerNameInput.setCustomValidity("玩家名称长度需为 1 至 9 个字符");
    playerNameInput.reportValidity();
    return;
  }
  playerNameInput.setCustomValidity("");
  preferences = {
    playerName,
    playerRingColor: selectedRingColor,
  };
  persistPreferences(preferences);
  game?.setPreferences(preferences);
  closeSettings();
});

function openOnline(): void {
  onlineDialog.hidden = false;
  closeOnlineButton.focus();
}

function closeOnline(): void {
  onlineDialog.hidden = true;
  onlineButton.focus();
}

onlineButton.addEventListener("click", openOnline);
closeOnlineButton.addEventListener("click", closeOnline);

async function copyGameLink(url: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const input = document.createElement("textarea");
  input.value = url;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) {
    throw new Error("Unable to copy game link");
  }
}

async function shareGame(): Promise<void> {
  const url = window.location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Hole City", text: "来吞掉这座城市", url });
      shareStatus.textContent = "已打开分享面板";
    } else {
      await copyGameLink(url);
      shareStatus.textContent = "游戏链接已复制";
    }
  } catch {
    try {
      await copyGameLink(url);
      shareStatus.textContent = "游戏链接已复制";
    } catch {
      shareStatus.textContent = "暂时无法分享链接";
    }
  }
}

shareButton.addEventListener("click", () => void shareGame());

function moveFocus(controls: readonly HTMLElement[], offset: number): void {
  const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
  const nextIndex = (Math.max(0, currentIndex) + offset + controls.length) % controls.length;
  const next = controls[nextIndex];
  next?.focus();
  if (next) {
    syncMenuFocus(next);
  }
}

function isArrowKey(code: string): boolean {
  return (
    code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" || code === "ArrowRight"
  );
}

function handleSettingsKeyboard(event: KeyboardEvent): void {
  if (event.code === "Escape") {
    event.preventDefault();
    closeSettings();
  }
}

window.addEventListener("keydown", (event) => {
  if (!settingsDialog.hidden) {
    handleSettingsKeyboard(event);
    return;
  }
  if (!onlineDialog.hidden) {
    if (event.code === "Escape") {
      event.preventDefault();
      closeOnline();
    }
    return;
  }
  if (!ui.launchScreen.hidden) {
    if (
      (event.code === "Enter" || event.code === "NumpadEnter") &&
      startMatchButton.classList.contains("is-menu-focused")
    ) {
      event.preventDefault();
      startMatchButton.click();
      return;
    }
    if (isArrowKey(event.code)) {
      moveFocus(menuButtons, event.code === "ArrowUp" || event.code === "ArrowLeft" ? -1 : 1);
      event.preventDefault();
      return;
    }
    return;
  }
  if (!ui.gameOver.hidden && isArrowKey(event.code)) {
    ui.restart.focus();
    event.preventDefault();
  }
});

void bootstrap();
window.addEventListener("pagehide", () => game?.dispose(), { once: true });
