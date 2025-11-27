/**
 * Type definitions for installation domain
 */

export interface EnvVarMetadata {
  key: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

export interface ArgMetadata {
  name?: string;
  description?: string;
  default?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  type?: string;
  choices?: string[];
  valueHint?: string;
}

export interface ServerConfigInput {
  localName?: string;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
}
