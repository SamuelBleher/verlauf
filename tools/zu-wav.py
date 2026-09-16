#!/usr/bin/env python3
"""Beliebige Audiodatei nach 16-kHz-Mono-WAV wandeln.

pyannote verschluckt sich an komprimierten Containern: es fordert einen Ausschnitt
an und bekommt ein paar Samples zu wenig zurück, dann bricht die Sprechertrennung
ab. Bei WAV passiert das nicht. Nutzt PyAV, damit kein ffmpeg nötig ist.

    zu-wav.py eingabe.webm ausgabe.wav
"""
import sys
import av
import av.audio.resampler


def convert(src: str, dst: str) -> float:
    with av.open(src) as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise SystemExit(f"keine Tonspur in {src}")
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)

        with av.open(dst, "w") as out:
            out_stream = out.add_stream("pcm_s16le", rate=16000, layout="mono")
            samples = 0
            for frame in container.decode(stream):
                frame.pts = None
                for resampled in resampler.resample(frame):
                    samples += resampled.samples
                    for packet in out_stream.encode(resampled):
                        out.mux(packet)
            # Resampler und Encoder leeren, sonst fehlt das Ende.
            for resampled in resampler.resample(None):
                samples += resampled.samples
                for packet in out_stream.encode(resampled):
                    out.mux(packet)
            for packet in out_stream.encode(None):
                out.mux(packet)
    return samples / 16000


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    seconds = convert(sys.argv[1], sys.argv[2])
    print(f"{seconds:.1f}")
