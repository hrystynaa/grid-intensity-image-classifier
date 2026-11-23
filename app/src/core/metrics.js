export function indexOfMax(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

// Sigmoid outputs do not sum to one, so they are scaled to shares for display.
export function toShares(outputs) {
  const values = Array.from(outputs, (value) => Math.max(0, value));
  const sum = values.reduce((total, value) => total + value, 0);
  return sum > 0 ? values.map((value) => value / sum) : values.map(() => 1 / values.length);
}

export function evaluate(predict, samples, classCount) {
  const confusion = Array.from({ length: classCount }, () => new Array(classCount).fill(0));
  let correct = 0;
  for (const sample of samples) {
    const predicted = indexOfMax(predict(sample.means));
    confusion[sample.classIndex][predicted]++;
    if (predicted === sample.classIndex) correct++;
  }
  return { total: samples.length, correct, accuracy: samples.length ? correct / samples.length : null, confusion };
}
