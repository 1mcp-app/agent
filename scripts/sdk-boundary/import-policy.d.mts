export interface ImportViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: string;
  readonly specifier: string;
}

export function checkSdkImportBoundary(root: string): Promise<ImportViolation[]>;
