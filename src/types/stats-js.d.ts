declare module 'stats.js' {
  export default class Stats {
    dom: HTMLDivElement;
    showPanel(id: number): void;
    begin(): void;
    end(): void;
    update(): void;
  }
}

