// An open-drain output (low or released, a pull-up does the rest) and an output never driven.
module open_drain (input irq, output irq_n, output nc);
  assign irq_n = irq ? 1'b0 : 1'bz;
  assign nc = 1'bz;
endmodule
