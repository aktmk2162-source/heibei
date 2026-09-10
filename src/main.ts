import { startLoop } from './game/loop';

const canvas = document.getElementById('app');
if (canvas instanceof HTMLCanvasElement) {
  startLoop(canvas);
}
