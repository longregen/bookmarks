import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getElement, getElements, createElement, showStatusMessage } from '../src/lib/dom';

describe('DOM utilities', () => {
  describe('getElement', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should return element by ID', () => {
      const div = document.createElement('div');
      div.id = 'test-element';
      document.body.appendChild(div);

      const result = getElement('test-element');
      expect(result).toBe(div);
    });

    it('should return correctly typed element', () => {
      const button = document.createElement('button');
      button.id = 'test-button';
      document.body.appendChild(button);

      const result = getElement<HTMLButtonElement>('test-button');
      expect(result).toBeInstanceOf(HTMLButtonElement);
      expect(result.disabled).toBe(false); // TypeScript knows this is a button
    });

    it('should throw error if element not found', () => {
      expect(() => getElement('non-existent')).toThrow('Required element #non-existent not found');
    });
  });

  describe('getElements', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('should return multiple elements by ID', () => {
      const div1 = document.createElement('div');
      div1.id = 'element-1';
      const div2 = document.createElement('div');
      div2.id = 'element-2';
      document.body.appendChild(div1);
      document.body.appendChild(div2);

      const [el1, el2] = getElements('element-1', 'element-2');
      expect(el1).toBe(div1);
      expect(el2).toBe(div2);
    });

    it('should throw if any element is not found', () => {
      const div = document.createElement('div');
      div.id = 'existing';
      document.body.appendChild(div);

      expect(() => getElements('existing', 'non-existent')).toThrow('Required element #non-existent not found');
    });
  });

  describe('createElement', () => {
    it('should create element with tag name', () => {
      const div = createElement('div');
      expect(div.tagName).toBe('DIV');
    });

    it('should set className', () => {
      const div = createElement('div', { className: 'my-class other-class' });
      expect(div.className).toBe('my-class other-class');
    });

    it('should not set className if empty string', () => {
      const div = createElement('div', { className: '' });
      expect(div.className).toBe('');
    });

    it('should set textContent', () => {
      const span = createElement('span', { textContent: 'Hello World' });
      expect(span.textContent).toBe('Hello World');
    });

    it('should not set textContent if empty string', () => {
      const span = createElement('span', { textContent: '' });
      expect(span.textContent).toBe('');
    });

    it('should set title attribute', () => {
      const div = createElement('div', { title: 'Tooltip text' });
      expect(div.title).toBe('Tooltip text');
    });

    it('should set href on anchor elements', () => {
      const link = createElement('a', { href: 'https://example.com' });
      expect((link as HTMLAnchorElement).href).toBe('https://example.com/');
    });

    it('should set target on anchor elements', () => {
      const link = createElement('a', { target: '_blank' });
      expect((link as HTMLAnchorElement).target).toBe('_blank');
    });

    it('should apply inline styles', () => {
      const div = createElement('div', {
        style: {
          color: 'red',
          fontSize: '16px',
          display: 'flex',
        },
      });
      expect(div.style.color).toBe('red');
      expect(div.style.fontSize).toBe('16px');
      expect(div.style.display).toBe('flex');
    });

    it('should set custom attributes', () => {
      const input = createElement('input', {
        attributes: {
          type: 'checkbox',
          'data-id': '123',
          'aria-label': 'Toggle option',
        },
      });
      expect(input.getAttribute('type')).toBe('checkbox');
      expect(input.getAttribute('data-id')).toBe('123');
      expect(input.getAttribute('aria-label')).toBe('Toggle option');
    });

    it('should append child elements', () => {
      const child1 = document.createElement('span');
      child1.textContent = 'Child 1';
      const child2 = document.createElement('span');
      child2.textContent = 'Child 2';

      const parent = createElement('div', {}, [child1, child2]);

      expect(parent.children.length).toBe(2);
      expect(parent.children[0]).toBe(child1);
      expect(parent.children[1]).toBe(child2);
    });

    it('should append string children as text nodes', () => {
      const parent = createElement('div', {}, ['Hello ', 'World']);

      expect(parent.textContent).toBe('Hello World');
      expect(parent.childNodes.length).toBe(2);
      expect(parent.childNodes[0]).toBeInstanceOf(Text);
    });

    it('should append mixed children', () => {
      const span = document.createElement('span');
      span.textContent = 'bold';

      const parent = createElement('div', {}, ['Hello ', span, '!']);

      expect(parent.textContent).toBe('Hello bold!');
      expect(parent.childNodes.length).toBe(3);
    });

    it('should create various element types', () => {
      expect(createElement('button').tagName).toBe('BUTTON');
      expect(createElement('input').tagName).toBe('INPUT');
      expect(createElement('select').tagName).toBe('SELECT');
      expect(createElement('table').tagName).toBe('TABLE');
      expect(createElement('ul').tagName).toBe('UL');
      expect(createElement('li').tagName).toBe('LI');
    });

    it('should handle undefined options', () => {
      const div = createElement('div', undefined);
      expect(div.tagName).toBe('DIV');
      expect(div.className).toBe('');
    });

    it('should handle empty options object', () => {
      const div = createElement('div', {});
      expect(div.tagName).toBe('DIV');
    });
  });

  describe('showStatusMessage', () => {
    let statusDiv: HTMLElement;

    beforeEach(() => {
      vi.useFakeTimers();
      statusDiv = document.createElement('div');
      statusDiv.classList.add('hidden');
      document.body.appendChild(statusDiv);
    });

    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = '';
    });

    it('should set message text', () => {
      showStatusMessage(statusDiv, 'Operation successful', 'success');
      expect(statusDiv.textContent).toBe('Operation successful');
    });

    it('should set success class', () => {
      showStatusMessage(statusDiv, 'Success!', 'success');
      expect(statusDiv.className).toContain('status');
      expect(statusDiv.className).toContain('success');
    });

    it('should set error class', () => {
      showStatusMessage(statusDiv, 'Error occurred', 'error');
      expect(statusDiv.className).toContain('status');
      expect(statusDiv.className).toContain('error');
    });

    it('should set warning class', () => {
      showStatusMessage(statusDiv, 'Warning message', 'warning');
      expect(statusDiv.className).toContain('status');
      expect(statusDiv.className).toContain('warning');
    });

    it('should remove hidden class', () => {
      statusDiv.classList.add('hidden');
      showStatusMessage(statusDiv, 'Visible now', 'success');
      expect(statusDiv.classList.contains('hidden')).toBe(false);
    });

    it('should hide after default timeout (3000ms)', () => {
      showStatusMessage(statusDiv, 'Will hide', 'success');
      expect(statusDiv.classList.contains('hidden')).toBe(false);

      vi.advanceTimersByTime(2999);
      expect(statusDiv.classList.contains('hidden')).toBe(false);

      vi.advanceTimersByTime(1);
      expect(statusDiv.classList.contains('hidden')).toBe(true);
    });

    it('should hide after custom timeout', () => {
      showStatusMessage(statusDiv, 'Custom timeout', 'success', 5000);
      expect(statusDiv.classList.contains('hidden')).toBe(false);

      vi.advanceTimersByTime(4999);
      expect(statusDiv.classList.contains('hidden')).toBe(false);

      vi.advanceTimersByTime(1);
      expect(statusDiv.classList.contains('hidden')).toBe(true);
    });

    it('should replace previous message', () => {
      showStatusMessage(statusDiv, 'First message', 'success');
      showStatusMessage(statusDiv, 'Second message', 'error');

      expect(statusDiv.textContent).toBe('Second message');
      expect(statusDiv.className).toContain('error');
      expect(statusDiv.className).not.toContain('success');
    });
  });
});
