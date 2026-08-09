type Listener = EventListenerOrEventListenerObject;

export class TestDomElement {
  readonly dataset: DOMStringMap;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(private readonly attributes: Map<string, string>) {
    this.dataset = Object.fromEntries(
      [...attributes]
        .filter(([name]) => name.startsWith("data-"))
        .map(([name, value]) => [toDatasetKey(name.slice(5)), value])
    ) as DOMStringMap;
  }

  get value(): string {
    return this.attributes.get("value") ?? "";
  }

  set value(value: string) {
    this.attributes.set("value", value);
  }

  get disabled(): boolean {
    return this.attributes.has("disabled");
  }

  get className(): string {
    return this.attributes.get("class") ?? "";
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async click(): Promise<void> {
    await this.dispatch("click");
  }

  async input(value: string): Promise<void> {
    this.value = value;
    await this.dispatch("input");
  }

  async change(value: string): Promise<void> {
    this.value = value;
    await this.dispatch("change");
  }

  private async dispatch(type: string): Promise<void> {
    const event = { target: this } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) {
      const result = typeof listener === "function" ? listener(event) : listener.handleEvent(event);
      await result;
    }
  }
}

export class TestDomRoot {
  private elements: TestDomElement[] = [];
  private markup = "";

  get innerHTML(): string {
    return this.markup;
  }

  set innerHTML(markup: string) {
    this.markup = markup;
    this.elements = parseElements(markup);
  }

  querySelector(selector: string): TestDomElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestDomElement[] {
    return this.elements.filter((element) => matchesSelector(element, selector));
  }
}

export async function flushMicrotasks(turns = 3): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

function parseElements(markup: string): TestDomElement[] {
  return [...markup.matchAll(/<(button|input)\b([^>]*)>/g)].map((match) => {
    const attributes = new Map<string, string>();
    for (const attribute of match[2]!.matchAll(/([:@\w-]+)(?:="([^"]*)")?/g)) {
      attributes.set(attribute[1]!, attribute[2] ?? "");
    }
    return new TestDomElement(attributes);
  });
}

function matchesSelector(element: TestDomElement, selector: string): boolean {
  const match = selector.match(/^\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/);
  if (!match) throw new Error(`Unsupported test DOM selector: ${selector}`);
  const name = match[1]!;
  const expected = match[2];
  const actual = element.getAttribute(name);
  return actual !== null && (expected === undefined || actual === expected);
}

function toDatasetKey(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
