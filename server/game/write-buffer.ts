interface BufferWriter {
  write(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
}

/** FileHandle.writeFile splits large buffers into many small async writes.
 * A busy simulation delays every callback. Submit the whole remaining buffer
 * instead, retrying legitimate short writes without ever publishing a prefix. */
export async function writeSnapshotBuffer(file: BufferWriter, data: Buffer): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await file.write(data, offset, data.length - offset, offset);
    if (bytesWritten <= 0) throw new Error("Snapshot write made no progress.");
    offset += bytesWritten;
  }
}
