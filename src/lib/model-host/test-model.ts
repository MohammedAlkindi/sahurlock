// Builds a tiny, valid ONNX model in memory: y = x + bias, x and y float[n].
// Field numbers are from onnx/onnx onnx/onnx.proto3. No dependency.

type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();

function varint(n: number): number[] {
  // Non-negative integers below 2^53 only, which covers every field here.
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
}

function concat(parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Wire type 0: int32, int64. */
const int = (field: number, value: number): Bytes => new Uint8Array([...varint(field << 3), ...varint(value)]);
/** Wire type 2: string, bytes, embedded message. */
const len = (field: number, body: Bytes): Bytes => concat([new Uint8Array([...varint((field << 3) | 2), ...varint(body.length)]), body]);
const str = (field: number, s: string): Bytes => len(field, enc.encode(s));

const FLOAT = 1; // TensorProto.DataType.FLOAT

/** TypeProto { tensor_type: Tensor { elem_type, shape: TensorShapeProto { dim: [{ dim_value }] } } } */
function floatTensorType(dims: number[]): Bytes {
  const shape = concat(dims.map((d) => len(1, int(1, d))));
  return len(1, concat([int(1, FLOAT), len(2, shape)]));
}

/** ValueInfoProto { name = 1, type = 2 } */
const valueInfo = (name: string, dims: number[]) => concat([str(1, name), len(2, floatTensorType(dims))]);

/** TensorProto { dims = 1, data_type = 2, name = 8, raw_data = 9 (little-endian) } */
function floatInitializer(name: string, values: number[]): Bytes {
  const raw = new Uint8Array(values.length * 4);
  const view = new DataView(raw.buffer);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return concat([int(1, values.length), int(2, FLOAT), str(8, name), len(9, raw)]);
}

/** NodeProto { input = 1, output = 2, name = 3, op_type = 4 } */
const node = (op: string, inputs: string[], outputs: string[], name: string) =>
  concat([...inputs.map((i) => str(1, i)), ...outputs.map((o) => str(2, o)), str(3, name), str(4, op)]);

export interface TinyModelOptions {
  /** Added to the input. Its length is the tensor length. */
  bias?: number[];
  /** Change it to get different bytes, and so a different SHA-256, for a mismatch test. */
  producerVersion?: string;
}

/** The bytes of an ONNX model computing y = x + bias, with IR version 8 and opset 13. */
export function tinyAddModel({ bias = [1, 2, 3], producerVersion = '1' }: TinyModelOptions = {}): Uint8Array<ArrayBuffer> {
  const n = bias.length;
  const graph = concat([
    len(1, node('Add', ['x', 'bias'], ['y'], 'add')),
    str(2, 'tiny-add'),
    len(5, floatInitializer('bias', bias)),
    len(11, valueInfo('x', [n])),
    len(12, valueInfo('y', [n])),
  ]);
  return concat([
    int(1, 8),                                // ir_version (IR_VERSION_2021_7_30)
    str(2, 'sahurlock-test'),                 // producer_name
    str(3, producerVersion),                  // producer_version
    len(7, graph),                            // graph
    len(8, int(2, 13)),                       // opset_import: default ONNX domain, version 13
  ]);
}
