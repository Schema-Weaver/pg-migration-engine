/**
 * Schema Weaver Migration Engine - Behavioral DDL
 * https://schemaweaver.vivekmind.com/
 */
export class PhaseSorter {
  /**
   * @param {Array<{type:string,phase:number,sql:string,name:string}>} items
   * @returns {Array<{type:string,phase:number,sql:string,name:string}>}
   */
  sort(items) {
    return [...items].sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      
      const phaseOrder = {
        'EXTENSION': 1,
        'TYPE': 2,
        'TABLE': 3,
        'FUNCTION': 4,
        'VIEW': 5,
        'TRIGGER': 6,
        'POLICY': 7,
        'GRANT': 8,
      };
      
      return (phaseOrder[a.type] || 9) - (phaseOrder[b.type] || 9);
    });
  }
}
