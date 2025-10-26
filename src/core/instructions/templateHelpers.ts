import Handlebars from 'handlebars';

/**
 * Register custom Handlebars helpers for template processing
 * These helpers provide mathematical, comparison, and string operations
 * that are commonly needed in instruction templates
 */
export function registerTemplateHelpers(): void {
  // Math helpers - handles chained operations like "a '/' b '*' 100"
  Handlebars.registerHelper('math', function (...args: unknown[]) {
    // Remove the last argument (options object)
    const values = args.slice(0, -1);

    if (values.length < 3) {
      return 0;
    }

    let result = parseFloat(String(values[0]));

    // Process operations in pairs (operator, value)
    for (let i = 1; i < values.length; i += 2) {
      const operator = String(values[i]);
      const value = parseFloat(String(values[i + 1]));

      switch (operator) {
        case '+':
          result = result + value;
          break;
        case '-':
          result = result - value;
          break;
        case '*':
          result = result * value;
          break;
        case '/':
          result = result / value;
          break;
        case '%':
          result = result % value;
          break;
        case '**':
          result = result ** value;
          break;
        default:
          return 0;
      }
    }

    // Round to nearest integer for percentage calculations
    return Math.round(result);
  });

  // Comparison helpers
  Handlebars.registerHelper('eq', function (a: unknown, b: unknown) {
    return a === b;
  });

  Handlebars.registerHelper('ne', function (a: unknown, b: unknown) {
    return a !== b;
  });

  Handlebars.registerHelper('gt', function (a: number, b: number) {
    return a > b;
  });

  Handlebars.registerHelper('lt', function (a: number, b: number) {
    return a < b;
  });

  // Logical helpers
  Handlebars.registerHelper('and', function (...args: unknown[]) {
    // Remove the last argument (options object)
    const values = args.slice(0, -1);
    return values.every((value) => !!value);
  });

  Handlebars.registerHelper('or', function (...args: unknown[]) {
    // Remove the last argument (options object)
    const values = args.slice(0, -1);
    return values.some((value) => !!value);
  });

  // String helpers
  Handlebars.registerHelper('contains', function (str: string, substring: string) {
    if (typeof str !== 'string' || typeof substring !== 'string') {
      return false;
    }
    return str.includes(substring);
  });

  Handlebars.registerHelper('startsWith', function (str: string, prefix: string) {
    if (typeof str !== 'string' || typeof prefix !== 'string') {
      return false;
    }
    return str.startsWith(prefix);
  });

  Handlebars.registerHelper('endsWith', function (str: string, suffix: string) {
    if (typeof str !== 'string' || typeof suffix !== 'string') {
      return false;
    }
    return str.endsWith(suffix);
  });

  // Math operation helpers
  Handlebars.registerHelper('subtract', function (a: number, b: number) {
    return (a || 0) - (b || 0);
  });

  Handlebars.registerHelper('div', function (a: number, b: number) {
    if (b === 0) return 0;
    return (a || 0) / (b || 1);
  });

  // String length helper
  Handlebars.registerHelper('len', function (str: string) {
    if (typeof str !== 'string') {
      return 0;
    }
    return str.length;
  });

  // String substring helper
  Handlebars.registerHelper('substring', function (str: string, start: number, end?: number) {
    if (typeof str !== 'string') {
      return '';
    }
    if (end !== undefined) {
      return str.substring(start, end);
    }
    return str.substring(start);
  });
}
