// A combinational loop: refused by HDL-1, iterated until it settles since HDL-9.
module loop (input a, output y);
  wire b;
  assign y = ~(a & b);
  assign b = y;
endmodule
