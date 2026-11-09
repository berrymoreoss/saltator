// Signed operands: refused until HDL-9.
module signed_lt (input signed [3:0] a, input signed [3:0] b, output lt);
  assign lt = a < b;
endmodule
