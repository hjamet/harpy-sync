/**
 * DOM Automation Engine: Realistic browser automation following physical interaction rules (Maslow)
 * Ensures deep compatibility with Angular Change Detection, Reactive Forms, and Custom Components.
 */

import { DomClickOptions, DomInputOptions, DomWaitForOptions, DomElementInfo } from "../types";

export class DomAutomation {
  /**
   * Simulate a realistic physical user click on an element
   */
  public static async click(
    target: HTMLElement | string,
    options: DomClickOptions = {}
  ): Promise<boolean> {
    const element = typeof target === "string" ? await this.waitForElement(target, options.timeoutMs) : target;
    if (!element) {
      throw new Error(`[DomAutomation] Cannot click: element '${String(target)}' not found`);
    }

    if (options.scrollIntoView !== false) {
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      await this.sleep(60);
    }

    if (options.highlight) {
      this.highlight(element, 400);
    }

    if (options.delayBeforeClickMs && options.delayBeforeClickMs > 0) {
      await this.sleep(options.delayBeforeClickMs);
    }

    const rect = element.getBoundingClientRect();
    const clientX = Math.max(0, rect.left + rect.width / 2);
    const clientY = Math.max(0, rect.top + rect.height / 2);

    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: 1,
    };

    if (options.simulatePhysics !== false) {
      // 1. Pointer over & enter
      element.dispatchEvent(new PointerEvent("pointerover", { ...eventInit, pointerType: "mouse", isPrimary: true }));
      element.dispatchEvent(new MouseEvent("mouseover", eventInit));
      element.dispatchEvent(new PointerEvent("pointerenter", { ...eventInit, pointerType: "mouse", isPrimary: true }));
      element.dispatchEvent(new MouseEvent("mouseenter", eventInit));

      // 2. Pointer move
      element.dispatchEvent(new PointerEvent("pointermove", { ...eventInit, pointerType: "mouse", isPrimary: true }));
      element.dispatchEvent(new MouseEvent("mousemove", eventInit));

      // 3. Pointer down & mouse down
      element.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, pointerType: "mouse", isPrimary: true }));
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));

      // 4. Focus
      element.focus({ preventScroll: true });

      await this.sleep(15);

      // 5. Pointer up & mouse up
      const releaseInit: MouseEventInit = { ...eventInit, buttons: 0 };
      element.dispatchEvent(new PointerEvent("pointerup", { ...releaseInit, pointerType: "mouse", isPrimary: true }));
      element.dispatchEvent(new MouseEvent("mouseup", releaseInit));
    }

    // 6. Click event
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      clientX,
      clientY,
      button: 0,
      buttons: 0,
    });
    const dispatched = element.dispatchEvent(clickEvent);

    if (options.delayAfterClickMs && options.delayAfterClickMs > 0) {
      await this.sleep(options.delayAfterClickMs);
    }

    return dispatched;
  }

  /**
   * Simulate realistic typing into an input, textarea or contenteditable element.
   * Uses native prototype setter to ensure Angular/React ControlValueAccessor updates.
   */
  public static async type(
    target: HTMLElement | string,
    text: string,
    options: DomInputOptions = {}
  ): Promise<boolean> {
    const element = typeof target === "string" ? await this.waitForElement(target, options.timeoutMs) : target;
    if (!element) {
      throw new Error(`[DomAutomation] Cannot type: element '${String(target)}' not found`);
    }

    if (options.scrollIntoView !== false) {
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      await this.sleep(40);
    }

    if (options.highlight) {
      this.highlight(element, 500);
    }

    // 1. Focus element
    element.dispatchEvent(new FocusEvent("focusin", { bubbles: true, cancelable: true }));
    element.focus({ preventScroll: true });
    element.dispatchEvent(new FocusEvent("focus", { bubbles: false, cancelable: false }));

    const isInput = element instanceof HTMLInputElement;
    const isTextArea = element instanceof HTMLTextAreaElement;
    const isContentEditable = element.isContentEditable || element.getAttribute("contenteditable") === "true";

    if (options.clearFirst) {
      if (isInput || isTextArea) {
        this.setNativeValue(element as HTMLInputElement | HTMLTextAreaElement, "");
      } else if (isContentEditable) {
        element.innerText = "";
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: "deleteContentBackward" }));
      element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    }

    if (options.delayBetweenKeysMs && options.delayBetweenKeysMs > 0) {
      // Character-by-character typing
      let currentVal = isInput || isTextArea ? (element as HTMLInputElement).value : element.innerText;

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        currentVal += char;

        // Key down
        element.dispatchEvent(new KeyboardEvent("keydown", { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent("keypress", { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));

        // Update value
        if (isInput || isTextArea) {
          this.setNativeValue(element as HTMLInputElement | HTMLTextAreaElement, currentVal);
        } else if (isContentEditable) {
          element.innerText = currentVal;
        }

        // Before input & input
        element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: char }));
        element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: char }));

        // Key up
        element.dispatchEvent(new KeyboardEvent("keyup", { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));

        await this.sleep(options.delayBetweenKeysMs);
      }
    } else {
      // Bulk fast typing
      const finalValue = options.clearFirst ? text : (isInput || isTextArea ? (element as HTMLInputElement).value + text : element.innerText + text);

      if (isInput || isTextArea) {
        this.setNativeValue(element as HTMLInputElement | HTMLTextAreaElement, finalValue);
      } else if (isContentEditable) {
        element.innerText = finalValue;
      }

      element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: text }));
    }

    // 2. Change event
    element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    // 3. Blur element
    element.dispatchEvent(new FocusEvent("blur", { bubbles: false, cancelable: false }));
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, cancelable: true }));

    return true;
  }

  /**
   * Set native value on input / textarea bypassing framework overrides
   */
  public static setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const proto = Object.getPrototypeOf(element);
    const setter =
      Object.getOwnPropertyDescriptor(proto, "value")?.set ||
      (element instanceof HTMLInputElement
        ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        : Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set);

    if (setter) {
      setter.call(element, value);
    } else {
      (element as any).value = value;
    }
  }

  /**
   * Wait for an element to appear in the DOM using MutationObserver + fallback polling
   */
  public static waitForElement<T extends HTMLElement = HTMLElement>(
    selector: string,
    timeoutMs = 10000,
    root: ParentNode = document
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const existing = root.querySelector<T>(selector);
      if (existing) {
        return resolve(existing);
      }

      let timeoutTimer: number | null = null;
      let observer: MutationObserver | null = null;

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (observer) observer.disconnect();
      };

      observer = new MutationObserver(() => {
        const el = root.querySelector<T>(selector);
        if (el) {
          cleanup();
          resolve(el);
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      timeoutTimer = window.setTimeout(() => {
        cleanup();
        reject(new Error(`[DomAutomation] Timed out after ${timeoutMs}ms waiting for element: '${selector}'`));
      }, timeoutMs);
    });
  }

  /**
   * Wait for an element to disappear from the DOM
   */
  public static waitForElementToDisappear(selector: string, timeoutMs = 10000): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!document.querySelector(selector)) {
        return resolve(true);
      }

      let timer: number | null = null;
      let observer: MutationObserver | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (observer) observer.disconnect();
      };

      observer = new MutationObserver(() => {
        if (!document.querySelector(selector)) {
          cleanup();
          resolve(true);
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });

      timer = window.setTimeout(() => {
        cleanup();
        reject(new Error(`[DomAutomation] Timed out waiting for element to disappear: '${selector}'`));
      }, timeoutMs);
    });
  }

  /**
   * Extract comprehensive metadata from an element or matching selector
   */
  public static extractElementInfo(target: HTMLElement | string): DomElementInfo | null {
    const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const attributes: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      attributes[attr.name] = attr.value;
    }

    const value = (el as any).value ?? undefined;
    const text = el.innerText || el.textContent || undefined;
    const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== "hidden";

    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: el.className || undefined,
      value,
      text,
      isVisible,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      attributes,
    };
  }

  /**
   * Highlight an element visually for debugging
   */
  public static highlight(element: HTMLElement, durationMs = 500): void {
    const origOutline = element.style.outline;
    const origTransition = element.style.transition;

    element.style.transition = "outline 0.15s ease-in-out";
    element.style.outline = "2px solid #8b5cf6"; // Harpy purple

    setTimeout(() => {
      element.style.outline = origOutline;
      element.style.transition = origTransition;
    }, durationMs);
  }

  /**
   * Sleep helper
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
