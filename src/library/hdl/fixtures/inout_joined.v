// Two inout ports joined inside the module: a wire between two pins, which a part can't be.
module inout_joined (inout [1:0] a, inout [1:0] b);
  assign a = b;
endmodule
