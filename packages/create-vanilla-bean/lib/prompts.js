import { MultiSelectPrompt, SelectPrompt, settings, wrapTextWithPrefix } from '@clack/core';
import {
  S_BAR,
  S_BAR_END,
  S_CHECKBOX_ACTIVE,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  limitOptions,
  symbol,
  symbolBar
} from '@clack/prompts';
import { styleText } from 'node:util';

const mapLines = (text, fn) => text.split('\n').map(fn).join('\n');

function renderSelectOption(option, state) {
  const label = option.label ?? String(option.value);
  switch (state) {
    case 'disabled':
      return `${styleText('gray', S_RADIO_INACTIVE)} ${mapLines(label, line => styleText('gray', line))}${
        option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''
      }`;
    case 'selected':
      return mapLines(label, line => styleText('dim', line));
    case 'active':
      return `${styleText('green', S_RADIO_ACTIVE)} ${label}${
        option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''
      }`;
    case 'cancelled':
      return mapLines(label, line => styleText(['strikethrough', 'dim'], line));
    default:
      return `${styleText('dim', S_RADIO_INACTIVE)} ${mapLines(label, line => styleText('dim', line))}`;
  }
}

export function select(opts) {
  return new SelectPrompt({
    options: opts.options,
    signal: opts.signal,
    input: opts.input,
    output: opts.output,
    initialValue: opts.initialValue,
    render() {
      const withGuide = opts.withGuide ?? settings.withGuide;
      const message = wrapTextWithPrefix(
        opts.output,
        opts.message,
        `${symbolBar(this.state)}  `,
        `${symbol(this.state)}  `
      );
      const header = `${withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${message}\n`;

      switch (this.state) {
        case 'submit': {
          const prefix = withGuide ? `${styleText('gray', S_BAR)}  ` : '';
          const selected = wrapTextWithPrefix(opts.output, renderSelectOption(this.options[this.cursor], 'selected'), prefix);
          return `${header}${selected}`;
        }
        case 'cancel': {
          const prefix = withGuide ? `${styleText('gray', S_BAR)}  ` : '';
          const cancelled = wrapTextWithPrefix(
            opts.output,
            renderSelectOption(this.options[this.cursor], 'cancelled'),
            prefix
          );
          return `${header}${cancelled}${withGuide ? `\n${styleText('gray', S_BAR)}` : ''}`;
        }
        default: {
          const prefix = withGuide ? `${styleText('cyan', S_BAR)}  ` : '';
          return `${header}${prefix}${limitOptions({
            output: opts.output,
            cursor: this.cursor,
            options: this.options,
            maxItems: opts.maxItems,
            columnPadding: prefix.length,
            rowPadding: header.split('\n').length,
            style: (option, active) => renderSelectOption(option, option.disabled ? 'disabled' : active ? 'active' : 'inactive')
          }).join(`\n${prefix}`)}\n${withGuide ? styleText('cyan', S_BAR_END) : ''}\n`;
        }
      }
    }
  }).prompt();
}

function renderMultiOption(option, state) {
  const label = option.label ?? String(option.value);
  switch (state) {
    case 'disabled':
      return `${styleText('gray', S_CHECKBOX_INACTIVE)} ${mapLines(label, line =>
        styleText(['strikethrough', 'gray'], line)
      )}${option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''}`;
    case 'active':
      return `${styleText('cyan', S_CHECKBOX_ACTIVE)} ${label}${
        option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''
      }`;
    case 'selected':
      return `${styleText('green', S_CHECKBOX_SELECTED)} ${mapLines(label, line => styleText('dim', line))}${
        option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''
      }`;
    case 'active-selected':
      return `${styleText('green', S_CHECKBOX_SELECTED)} ${label}${
        option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''
      }`;
    case 'submitted':
      return mapLines(label, line => styleText('dim', line));
    case 'cancelled':
      return mapLines(label, line => styleText(['strikethrough', 'dim'], line));
    default:
      return `${styleText('dim', S_CHECKBOX_INACTIVE)} ${mapLines(label, line => styleText('dim', line))}`;
  }
}

export function multiselect(opts) {
  const required = opts.required ?? true;

  return new MultiSelectPrompt({
    options: opts.options,
    signal: opts.signal,
    input: opts.input,
    output: opts.output,
    initialValues: opts.initialValues,
    required,
    cursorAt: opts.cursorAt,
    validate(value) {
      if (required && (value === undefined || value.length === 0)) return 'Please select at least one option.';
    },
    render() {
      const withGuide = opts.withGuide ?? settings.withGuide;
      const message = wrapTextWithPrefix(
        opts.output,
        opts.message,
        withGuide ? `${symbolBar(this.state)}  ` : '',
        `${symbol(this.state)}  `
      );
      const header = `${withGuide ? `${styleText('gray', S_BAR)}\n` : ''}${message}\n`;
      const value = this.value ?? [];
      const styleOption = (option, active) => {
        if (option.disabled) return renderMultiOption(option, 'disabled');
        const selected = value.includes(option.value);
        if (active && selected) return renderMultiOption(option, 'active-selected');
        if (selected) return renderMultiOption(option, 'selected');
        return renderMultiOption(option, active ? 'active' : 'inactive');
      };

      switch (this.state) {
        case 'submit': {
          const selected =
            this.options
              .filter(({ value: optionValue }) => value.includes(optionValue))
              .map(option => renderMultiOption(option, 'submitted'))
              .join(styleText('dim', ', ')) || styleText('dim', 'none');
          const prefix = withGuide ? `${styleText('gray', S_BAR)}  ` : '';
          return `${header}${wrapTextWithPrefix(opts.output, selected, prefix)}`;
        }
        case 'cancel': {
          const selected = this.options
            .filter(({ value: optionValue }) => value.includes(optionValue))
            .map(option => renderMultiOption(option, 'cancelled'))
            .join(styleText('dim', ', '));
          if (selected.trim() === '') return `${header}${styleText('gray', S_BAR)}`;
          const prefix = withGuide ? `${styleText('gray', S_BAR)}  ` : '';
          return `${header}${wrapTextWithPrefix(opts.output, selected, prefix)}${withGuide ? `\n${styleText('gray', S_BAR)}` : ''}`;
        }
        case 'error': {
          const prefix = withGuide ? `${styleText('yellow', S_BAR)}  ` : '';
          const error = this.error
            .split('\n')
            .map((line, index) =>
              index === 0 ? `${withGuide ? `${styleText('yellow', S_BAR_END)}  ` : ''}${styleText('yellow', line)}` : `   ${line}`
            )
            .join('\n');
          return `${header}${prefix}${limitOptions({
            output: opts.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: opts.maxItems,
            columnPadding: prefix.length,
            rowPadding: header.split('\n').length + error.split('\n').length + 1,
            style: styleOption
          }).join(`\n${prefix}`)}\n${error}\n`;
        }
        default: {
          const prefix = withGuide ? `${styleText('cyan', S_BAR)}  ` : '';
          return `${header}${prefix}${limitOptions({
            output: opts.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: opts.maxItems,
            columnPadding: prefix.length,
            rowPadding: header.split('\n').length,
            style: styleOption
          }).join(`\n${prefix}`)}\n${withGuide ? styleText('cyan', S_BAR_END) : ''}\n`;
        }
      }
    }
  }).prompt();
}
