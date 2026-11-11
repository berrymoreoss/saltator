// A 3-state register with its timing (HDL-2): Yosys keeps only rise and fall of a path, so taking
// and releasing the bus are two conditional paths from the enable (the condition is read after
// the change). Set-up and hold of a vector.
module spec_tristate (
    input clk,
    input oen,
    input [3:0] d,
    output [3:0] q
);
  reg [3:0] r;
  always @(posedge clk) r <= d;
  assign q = oen ? 4'bz : r;
  specify
    (posedge clk *> (q +: d)) = 17;
    if (!oen) (oen *> q) = 16;
    if (oen) (oen *> q) = 14;
    $setup(d, posedge clk, 12);
    $hold(posedge clk, d, 5);
  endspecify
endmodule
