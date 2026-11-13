// Paths whose minimum is below their typical delay (feat/hdl-timing): an output that changes is
// `X` from the minimum (a hold time) until the typical delay (a valid time); one that keeps its
// level doesn't move; an enable drives `X` at once and the level later, a release has no window.
module spec_window (
    input      clk,
    input      d,
    input      oe,
    output reg q,
    output     y
);
  always @(posedge clk) q <= d;
  assign y = oe ? q : 1'bz;
  specify
    (posedge clk *> (q +: d)) = (4:10:12, 4:10:12);
    if (oe) (oe *> y) = (0:6:6, 0:6:6);
    if (!oe) (oe *> y) = (6:6:6, 6:6:6);
    (posedge clk *> (y +: d)) = (4:10:12, 4:10:12);
  endspecify
endmodule
