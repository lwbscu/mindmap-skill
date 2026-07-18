export const InteractionState = Object.freeze({
  IDLE: 'idle',
  EDITING: 'editing',
  PANNING: 'panning',
  MARQUEE: 'marquee',
  LASSO: 'lasso',
  DRAGGING: 'dragging',
  CONNECTING: 'connecting',
});

const PRIORITY = Object.freeze({
  [InteractionState.EDITING]: 70,
  [InteractionState.CONNECTING]: 60,
  [InteractionState.DRAGGING]: 50,
  [InteractionState.LASSO]: 40,
  [InteractionState.MARQUEE]: 30,
  [InteractionState.PANNING]: 20,
  [InteractionState.IDLE]: 0,
});

const ALLOWED = Object.freeze({
  [InteractionState.IDLE]: new Set([
    InteractionState.EDITING,
    InteractionState.PANNING,
    InteractionState.MARQUEE,
    InteractionState.LASSO,
    InteractionState.DRAGGING,
    InteractionState.CONNECTING,
  ]),
  [InteractionState.EDITING]: new Set([InteractionState.IDLE]),
  [InteractionState.PANNING]: new Set([InteractionState.IDLE]),
  [InteractionState.MARQUEE]: new Set([InteractionState.IDLE]),
  [InteractionState.LASSO]: new Set([InteractionState.IDLE]),
  [InteractionState.DRAGGING]: new Set([InteractionState.IDLE]),
  [InteractionState.CONNECTING]: new Set([InteractionState.IDLE]),
});

export function priorityOf(state) {
  return PRIORITY[state] ?? -1;
}

export function canTransition(from, to) {
  return Boolean(ALLOWED[from]?.has(to));
}

export function resolveInteractionIntent(input = {}) {
  if (input.editing) {
    return InteractionState.EDITING;
  }

  if (input.connecting || input.tool === 'connect' || input.target === 'port') {
    return InteractionState.CONNECTING;
  }

  if (input.target === 'node' || input.dragSelected) {
    return InteractionState.DRAGGING;
  }

  if (input.tool === 'lasso' || input.altKey) {
    return InteractionState.LASSO;
  }

  if (input.spaceKey || input.middleButton || input.tool === 'hand') {
    return InteractionState.PANNING;
  }

  if (input.target === 'blank' && input.primaryButton !== false) {
    return InteractionState.MARQUEE;
  }

  return InteractionState.IDLE;
}

export class InteractionStateMachine {
  constructor(options = {}) {
    this.state = InteractionState.IDLE;
    this.context = {};
    this.clock = options.clock ?? (() => Date.now());
    this.events = [];
  }

  get active() {
    return this.state !== InteractionState.IDLE;
  }

  begin(nextState, context = {}) {
    if (!Object.values(InteractionState).includes(nextState)) {
      throw new TypeError(`Unknown interaction state: ${nextState}`);
    }

    if (!canTransition(this.state, nextState)) {
      return false;
    }

    this.state = nextState;
    this.context = {
      ...context,
      startedAt: this.clock(),
    };
    this.events.push({ type: 'begin', state: nextState, at: this.context.startedAt });
    return true;
  }

  beginFromInput(input = {}, context = {}) {
    const nextState = resolveInteractionIntent(input);
    if (nextState === InteractionState.IDLE) {
      return false;
    }
    return this.begin(nextState, { ...context, input });
  }

  update(patch = {}) {
    if (this.state === InteractionState.IDLE) {
      return false;
    }

    this.context = {
      ...this.context,
      ...patch,
      updatedAt: this.clock(),
    };
    return true;
  }

  end(result = {}) {
    if (this.state === InteractionState.IDLE) {
      return null;
    }

    const previous = {
      state: this.state,
      context: this.context,
      result,
      endedAt: this.clock(),
    };

    this.state = InteractionState.IDLE;
    this.context = {};
    this.events.push({ type: 'end', state: previous.state, at: previous.endedAt });
    return previous;
  }

  cancel(reason = 'cancelled') {
    return this.end({ cancelled: true, reason });
  }

  forceIdle() {
    const previous = this.state;
    this.state = InteractionState.IDLE;
    this.context = {};
    this.events.push({ type: 'force-idle', state: previous, at: this.clock() });
  }

  snapshot() {
    return {
      state: this.state,
      context: { ...this.context },
      active: this.active,
      priority: priorityOf(this.state),
    };
  }
}

export function createInteractionStateMachine(options) {
  return new InteractionStateMachine(options);
}
