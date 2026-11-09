// Outputs straight from inputs, constants, an unknown, one left undriven, two sharing a source.
module wires (
    input a,
    input [1:0] b,
    output y,
    output [1:0] z,
    output one,
    output [1:0] k,
    output unknown,
    output floating,
    output twin
);
  assign y = a;
  assign twin = a;
  assign z = {b[0], b[1]};
  assign one = 1'b1;
  assign k = 2'b10;
  assign unknown = 1'bx;
endmodule
