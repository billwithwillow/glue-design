export class PagesSidebar {
  private listEl: HTMLElement;
  private activePageId: string | null = null;

  constructor() {
    this.listEl = document.getElementById('pages-list')!;
    const addBtn = document.getElementById('add-page-btn')!;

    this.render();

    addBtn.addEventListener('click', async () => {
      const { pages } = await window.canvasAPI.canvas.listPages();
      await window.canvasAPI.canvas.createPage(`Page ${pages.length + 1}`);
      this.render();
    });
  }

  async render(): Promise<void> {
    const { pages, activePageId } = await window.canvasAPI.canvas.listPages();
    this.activePageId = activePageId;
    this.listEl.innerHTML = '';

    for (const page of pages) {
      const row = document.createElement('div');
      row.className = 'page-row';
      if (page.id === activePageId) row.classList.add('active');
      row.textContent = page.name;
      row.addEventListener('click', () => {
        window.canvasAPI.canvas.setActivePage(page.id);
      });
      this.listEl.appendChild(row);
    }
  }

  setActivePage(pageId: string): void {
    this.activePageId = pageId;
    for (const row of this.listEl.querySelectorAll<HTMLElement>('.page-row')) {
      const isActive = row.dataset.pageId === pageId;
      row.classList.toggle('active', isActive);
    }
    // Re-render for simplicity
    this.render();
  }
}
