const DEFAULT_LIMIT = 100;

function assertCommand(command) {
  if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
    throw new TypeError('Command must expose do() and undo() functions.');
  }
}

function compositeCommand(label, commands) {
  return {
    label,
    do() {
      for (const command of commands) {
        command.do();
      }
    },
    undo() {
      for (const command of [...commands].reverse()) {
        command.undo();
      }
    },
  };
}

export class CommandHistory {
  constructor(options = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.undoStack = [];
    this.redoStack = [];
    this.currentTransaction = null;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get isTransacting() {
    return Boolean(this.currentTransaction);
  }

  execute(command, options = {}) {
    assertCommand(command);
    command.do();
    this.record(command, options);
    return command;
  }

  record(command, options = {}) {
    assertCommand(command);

    if (options.skipHistory) {
      return;
    }

    if (this.currentTransaction) {
      this.currentTransaction.commands.push(command);
      return;
    }

    this.undoStack.push(command);
    this.trim();
    this.redoStack = [];
  }

  transaction(label, callback) {
    if (this.currentTransaction) {
      return callback(this);
    }

    this.currentTransaction = { label, commands: [] };
    try {
      const result = callback(this);
      this.commitTransaction();
      return result;
    } catch (error) {
      this.rollbackTransaction();
      throw error;
    }
  }

  commitTransaction() {
    if (!this.currentTransaction) {
      return null;
    }

    const { label, commands } = this.currentTransaction;
    this.currentTransaction = null;

    if (!commands.length) {
      return null;
    }

    const command = commands.length === 1 ? commands[0] : compositeCommand(label, commands);
    this.undoStack.push(command);
    this.trim();
    this.redoStack = [];
    return command;
  }

  rollbackTransaction() {
    if (!this.currentTransaction) {
      return;
    }

    const commands = this.currentTransaction.commands;
    this.currentTransaction = null;
    for (const command of [...commands].reverse()) {
      command.undo();
    }
  }

  undo() {
    if (!this.canUndo || this.currentTransaction) {
      return null;
    }

    const command = this.undoStack.pop();
    command.undo();
    this.redoStack.push(command);
    return command;
  }

  redo() {
    if (!this.canRedo || this.currentTransaction) {
      return null;
    }

    const command = this.redoStack.pop();
    command.do();
    this.undoStack.push(command);
    this.trim();
    return command;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.currentTransaction = null;
  }

  trim() {
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
  }

  snapshot() {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      isTransacting: this.isTransacting,
      currentLabel: this.currentTransaction?.label ?? null,
    };
  }
}

export function createCommandHistory(options) {
  return new CommandHistory(options);
}

export function command(label, doAction, undoAction) {
  return {
    label,
    do: doAction,
    undo: undoAction,
  };
}
