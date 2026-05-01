/**
 * Type declaration shims for packages without @types entries.
 *
 * drawflow@0.0.60 has no official @types package. This shim provides
 * the subset of the API used by FlowEditorPage.tsx so the dashboard
 * typecheck (`pnpm -F dashboard typecheck`) passes cleanly.
 */

declare module 'drawflow' {
  class Drawflow {
    constructor(element: HTMLElement, render?: any, parent?: any);
    /** Initialise the editor and attach DOM event listeners. */
    start(): void;
    /** Tear down the editor (not present in all versions — guard with `?.`). */
    destroy?(): void;
    /** Remove all nodes and edges from the canvas. */
    clear(): void;
    /** Import a serialised graph (replaces current canvas state). */
    import(data: object): void;
    /** Export the current canvas state as a serialisable object. */
    export(): object;
    /**
     * Add a node to the canvas.
     * @returns The numeric node id assigned by Drawflow.
     */
    addNode(
      name: string,
      inputs: number,
      outputs: number,
      pos_x: number,
      pos_y: number,
      className: string,
      data: object,
      html: string,
      typenode?: boolean,
    ): number;
    /** Update the data object associated with a node by its numeric id. */
    updateNodeDataFromId(id: number, data: object): void;
    /** Register an event listener. */
    on(event: string, callback: (...args: any[]) => void): void;
    /** When true, edges are re-routed around nodes automatically. */
    reroute: boolean;
    /** When true, fix curvature on re-routed edges. */
    reroute_fix_curvature: boolean;
    /**
     * Add a connection between two nodes.
     * @param id_output  Numeric id of the source node
     * @param id_input   Numeric id of the target node
     * @param output_class  e.g. 'output_1'
     * @param input_class   e.g. 'input_1'
     */
    addConnection(id_output: number, id_input: number, output_class: string, input_class: string): void;
    /** Remove a node by its DOM id string (e.g. 'node-5'). */
    removeNodeId(id: string): void;
    /** Zoom the canvas in. */
    zoom_in(): void;
    /** Zoom the canvas out. */
    zoom_out(): void;
  }
  export default Drawflow;
}
