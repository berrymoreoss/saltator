// A combinational loop: refused until HDL-9.
module loop (input a, output y);
  wire b;
  assign y = ~(a & b);
  assign b = y;
endmodule
