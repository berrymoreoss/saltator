// Shifts by a variable amount and a variable bit select.
module shifts (
    input [7:0] v,
    input [2:0] i,
    output [7:0] shl,
    output [7:0] sshl,
    output bit_i,
    output [1:0] pair
);
  assign shl = v << i;
  assign sshl = v <<< i;
  assign bit_i = v[i];
  assign pair = v[i+:2];
endmodule
