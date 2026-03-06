export const IPC_CHANNELS = {
  // Canvas operations
  CANVAS_COMPONENT_CREATED: 'canvas:component-created',
  CANVAS_COMPONENT_UPDATED: 'canvas:component-updated',
  CANVAS_ELEMENTS_APPENDED: 'canvas:elements-appended',
  CANVAS_DELETE_COMPONENT: 'canvas:delete-component',
  CANVAS_COMPONENT_DELETED: 'canvas:component-deleted',
  CANVAS_GET_SELECTED: 'canvas:get-selected',
  CANVAS_GET_SELECTED_RESULT: 'canvas:get-selected-result',
  CANVAS_UPDATE_POSITION: 'canvas:update-position',
  CANVAS_UPDATE_POSITIONS: 'canvas:update-positions',
  CANVAS_UPDATE_ELEMENT: 'canvas:update-element',
  CANVAS_DELETE_ELEMENT: 'canvas:delete-element',
  CANVAS_RESIZE_COMPONENT: 'canvas:resize-component',
  CANVAS_UPDATE_FRAME_PROPS: 'canvas:update-frame-props',
  CANVAS_NEST_COMPONENT: 'canvas:nest-component',
  CANVAS_UNNEST_COMPONENT: 'canvas:unnest-component',

  // Page management
  CANVAS_LIST_PAGES: 'canvas:list-pages',
  CANVAS_CREATE_PAGE: 'canvas:create-page',
  CANVAS_SET_ACTIVE_PAGE: 'canvas:set-active-page',
  CANVAS_PAGE_SWITCHED: 'canvas:page-switched',

  // Export
  CANVAS_EXPORT_COMPONENT: 'canvas:export-component',

  // Screenshot
  CANVAS_GET_COMPONENT_RECT: 'canvas:get-component-rect',
  CANVAS_GET_COMPONENT_RECT_RESULT: 'canvas:get-component-rect-result',
  CANVAS_CAPTURE_COMPONENT: 'canvas:capture-component',

  // Undo/Redo
  CANVAS_UNDO: 'canvas:undo',
  CANVAS_REDO: 'canvas:redo',

  // DevTools
  TOGGLE_DEVTOOLS: 'devtools:toggle',

  // App info
  GET_APP_INFO: 'app:info',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
