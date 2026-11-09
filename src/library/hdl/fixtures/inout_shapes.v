// Inout ports that aren't buffers: one only read, one driven by plain logic, one clocking a
// flip-flop, one assigned z and read (Yosys makes that read a constant z, not the pin).
module inout_shapes (
  input [1:0] a,
  inout [1:0] r,
  inout [1:0] w,
  inout c,
  inout z,
  output [1:0] rr,
  output reg q,
  output zr
);
  assign rr = r;
  assign w = a;
  always @(posedge c) q <= a[0];
  assign z = 1'bz;
  assign zr = z & a[1];
endmodule
