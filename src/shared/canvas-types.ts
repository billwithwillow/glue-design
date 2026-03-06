export interface ElementNode {
  id: string;
  tag: string;
  textContent?: string;
  attributes: Record<string, string>;
  classes: string[];
  styles: Record<string, string>;
  children: ElementNode[];
}

export interface FrameProps {
  fill?: string;        // CSS background value (default: 'white')
  shadow?: string;      // CSS box-shadow value; '' or 'none' = no shadow
  cornerRadius?: number; // px (default: 12)
  border?: string;      // CSS border (default: '1.5px solid #e5e5e5')
  clipContent?: boolean; // overflow: hidden on content (default: true)
}

export interface CanvasComponent {
  id: string;
  name: string;
  rootElements: ElementNode[];
  cssRules: string;
  width: number;
  height: number;
  x: number;
  y: number;
  frameProps?: FrameProps;
}

export interface CanvasPage {
  id: string;
  name: string;
  components: Record<string, CanvasComponent>;
  viewport: { panX: number; panY: number; zoom: number };
}

export interface CanvasProject {
  id: string;
  name: string;
  pages: Record<string, CanvasPage>;
  pageOrder: string[];
  activePageId: string;
}
