# Test fixtures

`canonical-face.json` holds the 468 vertices, in centimetres, of MediaPipe's
canonical face model
([`mediapipe/modules/face_geometry/data/canonical_face_model.obj`](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj)),
rounded to four decimals. MediaPipe is licensed under the Apache License 2.0.
`e2e/fake-face.ts` projects it through a virtual webcam so browser tests can
put a face in front of the detector at a chosen head pose.
